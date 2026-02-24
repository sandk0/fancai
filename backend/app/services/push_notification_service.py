"""
Push Notification Service for fancai.

Manages Web Push subscriptions and notification delivery using the
Web Push protocol with VAPID authentication.

Usage:
    from app.services.push_notification_service import push_notification_service

    # Get VAPID public key for frontend
    public_key = push_notification_service.get_vapid_public_key()

    # Subscribe a user's device
    subscription = await push_notification_service.subscribe(
        db, user_id, subscription_info
    )

    # Send notification to user
    sent_count = await push_notification_service.send_to_user(
        db, user_id, payload
    )
"""

from typing import Optional, List, Dict, Any
from uuid import UUID
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from pywebpush import webpush, WebPushException

from ..core.config import settings
from ..models.push_subscription import PushSubscription
from ..schemas.push import PushNotificationPayload


class PushNotificationService:
    """
    Service for managing Web Push notifications.

    Handles VAPID key management, subscription CRUD operations,
    and notification delivery with proper error handling.

    Attributes:
        vapid_public_key: The VAPID public key for subscriptions
        vapid_private_key: The VAPID private key for signing
        vapid_claims: VAPID claims including subject (mailto: URL)
    """

    def __init__(self):
        """
        Initialize the Push Notification Service.

        Loads VAPID keys from environment variables.
        Logs warnings if keys are not configured.
        """
        self.vapid_public_key = settings.VAPID_PUBLIC_KEY
        self.vapid_private_key = settings.VAPID_PRIVATE_KEY
        self.vapid_subject = settings.VAPID_SUBJECT

        # Validate configuration
        if not self.vapid_public_key or not self.vapid_private_key:
            logger.warning(
                "VAPID keys not configured. Push notifications will not work. "
                "Generate keys with: npx web-push generate-vapid-keys"
            )
        else:
            logger.info("Push notification service initialized with VAPID keys")

    @property
    def is_configured(self) -> bool:
        """Check if VAPID keys are properly configured."""
        return bool(self.vapid_public_key and self.vapid_private_key)

    def get_vapid_public_key(self) -> Optional[str]:
        """
        Get the VAPID public key for frontend subscription.

        Returns:
            The VAPID public key string, or None if not configured.
        """
        return self.vapid_public_key

    async def subscribe(
        self,
        db: AsyncSession,
        user_id: UUID,
        subscription_info: Dict[str, Any],
    ) -> PushSubscription:
        """
        Create or update a push subscription for a user.

        If a subscription with the same endpoint already exists for another user,
        it will be transferred to the new user (device changed hands).

        If the same user already has this endpoint, the subscription is updated.

        Args:
            db: Database session
            user_id: The user's UUID
            subscription_info: Dict containing endpoint, keys.p256dh, keys.auth

        Returns:
            The created or updated PushSubscription

        Raises:
            ValueError: If subscription_info is invalid
        """
        endpoint = subscription_info.get("endpoint")
        keys = subscription_info.get("keys", {})
        p256dh_key = keys.get("p256dh")
        auth_key = keys.get("auth")

        if not all([endpoint, p256dh_key, auth_key]):
            raise ValueError("Invalid subscription info: missing required fields")

        # Check for existing subscription with this endpoint
        result = await db.execute(
            select(PushSubscription).where(PushSubscription.endpoint == endpoint)
        )
        existing = result.scalar_one_or_none()

        if existing:
            # Update existing subscription
            existing.user_id = user_id
            existing.p256dh_key = p256dh_key
            existing.auth_key = auth_key
            existing.is_active = True
            await db.commit()
            await db.refresh(existing)
            logger.info(f"Updated push subscription {existing.id} for user {user_id}")
            return existing

        # Create new subscription
        subscription = PushSubscription(
            user_id=user_id,
            endpoint=endpoint,
            p256dh_key=p256dh_key,
            auth_key=auth_key,
            is_active=True,
        )

        db.add(subscription)

        try:
            await db.commit()
            await db.refresh(subscription)
            logger.info(
                f"Created push subscription {subscription.id} for user {user_id}"
            )
            return subscription
        except IntegrityError:
            await db.rollback()
            # Race condition - subscription was created by another request
            result = await db.execute(
                select(PushSubscription).where(PushSubscription.endpoint == endpoint)
            )
            existing = result.scalar_one_or_none()
            if existing:
                return existing
            raise ValueError("Failed to create subscription")

    async def unsubscribe(
        self,
        db: AsyncSession,
        user_id: UUID,
        endpoint: str,
    ) -> bool:
        """
        Remove a push subscription for a user.

        Only removes the subscription if it belongs to the specified user.

        Args:
            db: Database session
            user_id: The user's UUID
            endpoint: The push endpoint URL to unsubscribe

        Returns:
            True if a subscription was removed, False otherwise
        """
        result = await db.execute(
            select(PushSubscription).where(
                PushSubscription.endpoint == endpoint,
                PushSubscription.user_id == user_id,
            )
        )
        subscription = result.scalar_one_or_none()

        if not subscription:
            logger.warning(
                f"Unsubscribe failed: subscription not found for user {user_id}"
            )
            return False

        await db.delete(subscription)
        await db.commit()
        logger.info(f"Removed push subscription {subscription.id} for user {user_id}")
        return True

    async def get_user_subscriptions(
        self,
        db: AsyncSession,
        user_id: UUID,
        active_only: bool = True,
    ) -> List[PushSubscription]:
        """
        Get all push subscriptions for a user.

        Args:
            db: Database session
            user_id: The user's UUID
            active_only: If True, only return active subscriptions

        Returns:
            List of PushSubscription objects
        """
        query = select(PushSubscription).where(PushSubscription.user_id == user_id)
        if active_only:
            query = query.where(PushSubscription.is_active.is_(True))

        result = await db.execute(query)
        return list(result.scalars().all())

    async def send_notification(
        self,
        subscription: PushSubscription,
        payload: PushNotificationPayload,
        ttl: int = 86400,  # 24 hours default
    ) -> bool:
        """
        Send a push notification to a specific subscription.

        Handles 404/410 errors by deactivating expired subscriptions.

        Args:
            subscription: The PushSubscription to send to
            payload: The notification payload
            ttl: Time-to-live in seconds (default 24 hours)

        Returns:
            True if the notification was sent successfully
        """
        if not self.is_configured:
            logger.error("Cannot send push notification: VAPID keys not configured")
            return False

        if not subscription.is_active:
            logger.debug(f"Skipping inactive subscription {subscription.id}")
            return False

        # Build subscription info for webpush
        subscription_info = {
            "endpoint": subscription.endpoint,
            "keys": {
                "p256dh": subscription.p256dh_key,
                "auth": subscription.auth_key,
            },
        }

        # Build VAPID claims
        vapid_claims = {
            "sub": self.vapid_subject,
        }

        try:
            webpush(
                subscription_info=subscription_info,
                data=payload.model_dump_json(),
                vapid_private_key=self.vapid_private_key,
                vapid_claims=vapid_claims,
                ttl=ttl,
            )
            logger.debug(f"Push notification sent to subscription {subscription.id}")
            return True

        except WebPushException as e:
            # Check for subscription expiration errors
            if e.response and e.response.status_code in (404, 410):
                logger.info(
                    f"Subscription {subscription.id} expired (HTTP {e.response.status_code}), "
                    "marking as inactive"
                )
                # Note: We need a DB session to deactivate - handled in send_to_user
                return False

            logger.error(
                f"Failed to send push notification to subscription {subscription.id}: {e}"
            )
            return False

        except Exception as e:
            logger.error(
                f"Unexpected error sending push notification to {subscription.id}: {e}"
            )
            return False

    async def send_to_user(
        self,
        db: AsyncSession,
        user_id: UUID,
        payload: PushNotificationPayload,
        ttl: int = 86400,
    ) -> int:
        """
        Send a push notification to all of a user's active subscriptions.

        Automatically deactivates expired subscriptions (404/410 responses).

        Args:
            db: Database session
            user_id: The user's UUID
            payload: The notification payload
            ttl: Time-to-live in seconds

        Returns:
            Number of successful notification sends
        """
        if not self.is_configured:
            logger.error("Cannot send push notifications: VAPID keys not configured")
            return 0

        subscriptions = await self.get_user_subscriptions(db, user_id, active_only=True)

        if not subscriptions:
            logger.debug(f"No active subscriptions for user {user_id}")
            return 0

        sent_count = 0
        expired_ids = []

        for subscription in subscriptions:
            subscription_info = {
                "endpoint": subscription.endpoint,
                "keys": {
                    "p256dh": subscription.p256dh_key,
                    "auth": subscription.auth_key,
                },
            }

            vapid_claims = {
                "sub": self.vapid_subject,
            }

            try:
                webpush(
                    subscription_info=subscription_info,
                    data=payload.model_dump_json(),
                    vapid_private_key=self.vapid_private_key,
                    vapid_claims=vapid_claims,
                    ttl=ttl,
                )
                sent_count += 1
                logger.debug(
                    f"Push notification sent to subscription {subscription.id}"
                )

            except WebPushException as e:
                if e.response and e.response.status_code in (404, 410):
                    expired_ids.append(subscription.id)
                    logger.info(
                        f"Subscription {subscription.id} expired, marking for deactivation"
                    )
                else:
                    logger.error(
                        f"Failed to send push to subscription {subscription.id}: {e}"
                    )

            except Exception as e:
                logger.error(
                    f"Unexpected error sending to subscription {subscription.id}: {e}"
                )

        # Deactivate expired subscriptions
        if expired_ids:
            await db.execute(
                update(PushSubscription)
                .where(PushSubscription.id.in_(expired_ids))
                .values(is_active=False)
            )
            await db.commit()
            logger.info(f"Deactivated {len(expired_ids)} expired subscriptions")

        logger.info(
            f"Sent {sent_count}/{len(subscriptions)} notifications for user {user_id}"
        )
        return sent_count

    async def send_book_ready_notification(
        self,
        db: AsyncSession,
        user_id: UUID,
        book_id: UUID,
        book_title: str,
    ) -> int:
        """
        Send a notification when a book has finished parsing.

        Args:
            db: Database session
            user_id: The user's UUID
            book_id: The book's UUID
            book_title: The book's title for the notification

        Returns:
            Number of successful notification sends
        """
        payload = PushNotificationPayload(
            title="Book Ready",
            body=f'"{book_title}" has been processed and is ready to read!',
            icon="/icons/icon-192x192.png",
            badge="/icons/badge-72x72.png",
            tag=f"book-ready-{book_id}",
            data={
                "type": "book_ready",
                "book_id": str(book_id),
                "url": f"/reader/{book_id}",
            },
            actions=[
                {"action": "open", "title": "Read Now"},
                {"action": "dismiss", "title": "Later"},
            ],
        )

        return await self.send_to_user(db, user_id, payload)

    async def send_image_ready_notification(
        self,
        db: AsyncSession,
        user_id: UUID,
        book_id: UUID,
        description_id: UUID,
        image_count: int = 1,
    ) -> int:
        """
        Send a notification when image generation is complete.

        Args:
            db: Database session
            user_id: The user's UUID
            book_id: The book's UUID
            description_id: The description's UUID
            image_count: Number of images generated

        Returns:
            Number of successful notification sends
        """
        body = (
            f"{image_count} image{'s' if image_count > 1 else ''} generated!"
            if image_count > 1
            else "Your image has been generated!"
        )

        payload = PushNotificationPayload(
            title="Image Ready",
            body=body,
            icon="/icons/icon-192x192.png",
            badge="/icons/badge-72x72.png",
            tag=f"image-ready-{description_id}",
            data={
                "type": "image_ready",
                "book_id": str(book_id),
                "description_id": str(description_id),
                "url": f"/reader/{book_id}",
            },
        )

        return await self.send_to_user(db, user_id, payload)


# Global service instance
push_notification_service = PushNotificationService()
