"""
API routes for Push Notifications in fancai.

Provides endpoints for managing Web Push subscriptions and
sending test notifications. Supports PWA push notifications
for book parsing completion and image generation events.

Usage:
    # Get VAPID public key (no auth required)
    GET /api/v1/push/vapid-public-key

    # Subscribe to push notifications
    POST /api/v1/push/subscribe

    # Unsubscribe from push notifications
    DELETE /api/v1/push/unsubscribe

    # List user's subscriptions
    GET /api/v1/push/subscriptions

    # Send test notification
    POST /api/v1/push/test
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from loguru import logger

from ..core.database import get_database_session
from ..core.auth import get_current_active_user
from ..models.user import User
from ..services.push_notification_service import push_notification_service
from ..schemas.push import (
    PushSubscriptionCreate,
    PushSubscriptionUnsubscribe,
    PushSubscriptionResponse,
    PushSubscriptionListResponse,
    VAPIDPublicKeyResponse,
    PushSubscriptionCreateResponse,
    PushSubscriptionDeleteResponse,
    TestNotificationRequest,
    TestNotificationResponse,
    PushNotificationPayload,
)

router = APIRouter(tags=["push"])


@router.get(
    "/push/vapid-public-key",
    response_model=VAPIDPublicKeyResponse,
    summary="Get VAPID public key",
    description="Returns the VAPID public key needed to subscribe to push notifications. "
    "This endpoint does not require authentication.",
)
async def get_vapid_public_key() -> VAPIDPublicKeyResponse:
    """
    Get the VAPID public key for push subscription.

    This endpoint is public (no authentication required) because
    the VAPID public key is needed by the browser before the user
    can subscribe to push notifications.

    Returns:
        VAPIDPublicKeyResponse with the public key

    Raises:
        HTTPException: If VAPID is not configured (503 Service Unavailable)
    """
    public_key = push_notification_service.get_vapid_public_key()

    if not public_key:
        logger.warning("VAPID public key requested but not configured")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications are not configured. VAPID keys are missing.",
        )

    return VAPIDPublicKeyResponse(publicKey=public_key)


@router.post(
    "/push/subscribe",
    response_model=PushSubscriptionCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Subscribe to push notifications",
    description="Create a push subscription for the current user's device. "
    "The subscription info should be obtained from the browser's "
    "PushManager.subscribe() method.",
)
async def subscribe(
    subscription_data: PushSubscriptionCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> PushSubscriptionCreateResponse:
    """
    Create a push notification subscription.

    Args:
        subscription_data: Push subscription info from browser
        current_user: The authenticated user
        db: Database session

    Returns:
        The created subscription info

    Raises:
        HTTPException: If push is not configured or subscription fails
    """
    if not push_notification_service.is_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications are not configured",
        )

    try:
        subscription = await push_notification_service.subscribe(
            db=db,
            user_id=current_user.id,
            subscription_info={
                "endpoint": subscription_data.endpoint,
                "keys": {
                    "p256dh": subscription_data.keys.p256dh,
                    "auth": subscription_data.keys.auth,
                },
            },
        )

        logger.info(
            f"User {current_user.id} subscribed to push notifications "
            f"(subscription_id={subscription.id})"
        )

        # Return truncated endpoint for privacy
        endpoint_display = (
            subscription.endpoint[:50] + "..."
            if len(subscription.endpoint) > 50
            else subscription.endpoint
        )

        return PushSubscriptionCreateResponse(
            subscription=PushSubscriptionResponse(
                id=subscription.id,
                endpoint=endpoint_display,
                created_at=subscription.created_at,
                is_active=subscription.is_active,
            ),
            message="Push subscription created successfully",
        )

    except ValueError as e:
        logger.warning(f"Invalid subscription data from user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid subscription data",
        )

    except Exception as e:
        logger.error(f"Failed to create subscription for user {current_user.id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create push subscription",
        )


@router.delete(
    "/push/unsubscribe",
    response_model=PushSubscriptionDeleteResponse,
    summary="Unsubscribe from push notifications",
    description="Remove a push subscription for the current user's device.",
)
async def unsubscribe(
    unsubscribe_data: PushSubscriptionUnsubscribe,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> PushSubscriptionDeleteResponse:
    """
    Remove a push notification subscription.

    Args:
        unsubscribe_data: The endpoint to unsubscribe
        current_user: The authenticated user
        db: Database session

    Returns:
        Confirmation of deletion

    Raises:
        HTTPException: If subscription not found
    """
    deleted = await push_notification_service.unsubscribe(
        db=db,
        user_id=current_user.id,
        endpoint=unsubscribe_data.endpoint,
    )

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Subscription not found",
        )

    logger.info(f"User {current_user.id} unsubscribed from push notifications")

    return PushSubscriptionDeleteResponse(
        deleted=True,
        message="Push subscription deleted successfully",
    )


@router.get(
    "/push/subscriptions",
    response_model=PushSubscriptionListResponse,
    summary="List push subscriptions",
    description="Get all push subscriptions for the current user.",
)
async def list_subscriptions(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> PushSubscriptionListResponse:
    """
    List all push subscriptions for the current user.

    Args:
        current_user: The authenticated user
        db: Database session

    Returns:
        List of user's push subscriptions
    """
    subscriptions = await push_notification_service.get_user_subscriptions(
        db=db,
        user_id=current_user.id,
        active_only=False,  # Show all subscriptions including inactive
    )

    # Truncate endpoints for privacy
    subscription_responses = [
        PushSubscriptionResponse(
            id=sub.id,
            endpoint=(
                sub.endpoint[:50] + "..." if len(sub.endpoint) > 50 else sub.endpoint
            ),
            created_at=sub.created_at,
            is_active=sub.is_active,
        )
        for sub in subscriptions
    ]

    return PushSubscriptionListResponse(
        subscriptions=subscription_responses,
        total=len(subscription_responses),
    )


@router.post(
    "/push/test",
    response_model=TestNotificationResponse,
    summary="Send test notification",
    description="Send a test push notification to all of the current user's devices. "
    "Useful for verifying that push notifications are working correctly.",
)
async def send_test_notification(
    request: Optional[TestNotificationRequest] = None,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_database_session),
) -> TestNotificationResponse:
    """
    Send a test push notification to the current user.

    Args:
        request: Optional custom title and body for the notification
        current_user: The authenticated user
        db: Database session

    Returns:
        Results of the notification send attempt

    Raises:
        HTTPException: If push is not configured
    """
    if not push_notification_service.is_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications are not configured",
        )

    # Use custom or default notification content
    title = request.title if request and request.title else "Test Notification"
    body = (
        request.body
        if request and request.body
        else "This is a test notification from fancai. Push notifications are working!"
    )

    payload = PushNotificationPayload(
        title=title,
        body=body,
        icon="/icons/icon-192x192.png",
        badge="/icons/badge-72x72.png",
        tag="test-notification",
        data={
            "type": "test",
            "timestamp": str(current_user.id),
        },
    )

    # Get subscription count before sending
    subscriptions = await push_notification_service.get_user_subscriptions(
        db=db,
        user_id=current_user.id,
        active_only=True,
    )

    if not subscriptions:
        return TestNotificationResponse(
            sent=0,
            failed=0,
            message="No active push subscriptions found for this user",
        )

    sent_count = await push_notification_service.send_to_user(
        db=db,
        user_id=current_user.id,
        payload=payload,
    )

    failed_count = len(subscriptions) - sent_count

    logger.info(
        f"Test notification for user {current_user.id}: "
        f"sent={sent_count}, failed={failed_count}"
    )

    if sent_count == 0:
        return TestNotificationResponse(
            sent=0,
            failed=failed_count,
            message="Failed to send test notification to any device",
        )

    return TestNotificationResponse(
        sent=sent_count,
        failed=failed_count,
        message=f"Test notification sent to {sent_count} device(s)",
    )
