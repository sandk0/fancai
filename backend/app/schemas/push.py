"""
Pydantic schemas for Push Notifications in fancai.

Contains request and response schemas for the Push API endpoints,
supporting Web Push subscriptions and notification payloads.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID

# ============================================================================
# REQUEST SCHEMAS
# ============================================================================


class PushSubscriptionKeys(BaseModel):
    """
    Keys from the browser's PushSubscription object.

    These are provided by the browser when subscribing to push notifications.

    Attributes:
        p256dh: The client's P-256 ECDH public key (base64url encoded)
        auth: The client's authentication secret (base64url encoded)
    """

    p256dh: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="P-256 ECDH public key (base64url encoded)",
    )
    auth: str = Field(
        ...,
        min_length=1,
        max_length=50,
        description="Authentication secret (base64url encoded)",
    )


class PushSubscriptionCreate(BaseModel):
    """
    Request schema for creating a push subscription.

    This matches the structure of the browser's PushSubscription.toJSON() output.

    Attributes:
        endpoint: The push service endpoint URL
        keys: Encryption keys (p256dh and auth)
    """

    endpoint: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Push service endpoint URL",
    )
    keys: PushSubscriptionKeys = Field(
        ...,
        description="Encryption keys from PushSubscription",
    )


class PushSubscriptionUnsubscribe(BaseModel):
    """
    Request schema for unsubscribing from push notifications.

    Attributes:
        endpoint: The push service endpoint URL to unsubscribe
    """

    endpoint: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Push service endpoint URL to unsubscribe",
    )


# ============================================================================
# NOTIFICATION PAYLOAD SCHEMAS
# ============================================================================


class NotificationAction(BaseModel):
    """
    Action button for push notification.

    Attributes:
        action: Identifier for the action
        title: Text shown on the button
        icon: Optional icon URL for the action
    """

    action: str = Field(..., min_length=1, max_length=50)
    title: str = Field(..., min_length=1, max_length=100)
    icon: Optional[str] = Field(None, max_length=500)


class PushNotificationPayload(BaseModel):
    """
    Payload for a push notification.

    This is sent to the push service and delivered to the user's device.

    Attributes:
        title: The notification title (required)
        body: The notification body text (required)
        icon: URL to the notification icon
        badge: URL to the badge icon (for mobile)
        tag: Tag for notification grouping/replacement
        data: Custom data to include with the notification
        actions: Action buttons for the notification
        requireInteraction: Whether the notification should stay until dismissed
        silent: Whether the notification should be silent
    """

    title: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="Notification title",
    )
    body: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Notification body text",
    )
    icon: Optional[str] = Field(
        None,
        max_length=500,
        description="URL to notification icon",
    )
    badge: Optional[str] = Field(
        None,
        max_length=500,
        description="URL to badge icon (mobile)",
    )
    tag: Optional[str] = Field(
        None,
        max_length=100,
        description="Tag for notification grouping",
    )
    data: Optional[Dict[str, Any]] = Field(
        None,
        description="Custom data payload",
    )
    actions: Optional[List[NotificationAction]] = Field(
        None,
        max_length=3,
        description="Action buttons (max 3)",
    )
    requireInteraction: Optional[bool] = Field(
        None,
        description="Keep notification until dismissed",
    )
    silent: Optional[bool] = Field(
        None,
        description="Silent notification (no sound/vibration)",
    )


class TestNotificationRequest(BaseModel):
    """
    Request for sending a test notification.

    Attributes:
        title: Optional custom title (default: "Test Notification")
        body: Optional custom body (default: "This is a test notification from fancai")
    """

    title: Optional[str] = Field(
        None,
        max_length=200,
        description="Custom notification title",
    )
    body: Optional[str] = Field(
        None,
        max_length=500,
        description="Custom notification body",
    )


# ============================================================================
# RESPONSE SCHEMAS
# ============================================================================


class BaseResponse(BaseModel):
    """Base response schema with ORM support."""

    model_config = ConfigDict(from_attributes=True)


class PushSubscriptionResponse(BaseResponse):
    """
    Response schema for a push subscription.

    Attributes:
        id: Subscription UUID
        endpoint: The push service endpoint URL (truncated for privacy)
        created_at: When the subscription was created
        is_active: Whether the subscription is active
    """

    id: UUID
    endpoint: str = Field(description="Push endpoint URL (truncated)")
    created_at: datetime
    is_active: bool


class PushSubscriptionListResponse(BaseModel):
    """
    Response for listing user's push subscriptions.

    Attributes:
        subscriptions: List of subscription summaries
        total: Total number of subscriptions
    """

    subscriptions: List[PushSubscriptionResponse]
    total: int = Field(ge=0)


class VAPIDPublicKeyResponse(BaseModel):
    """
    Response containing the VAPID public key.

    The client uses this to subscribe to push notifications.

    Attributes:
        publicKey: The VAPID public key (base64url encoded)
    """

    publicKey: str = Field(
        ...,
        description="VAPID public key for push subscription",
    )


class PushSubscriptionCreateResponse(BaseModel):
    """
    Response after successfully creating a subscription.

    Attributes:
        subscription: The created subscription
        message: Success message
    """

    subscription: PushSubscriptionResponse
    message: str = Field(default="Push subscription created successfully")


class PushSubscriptionDeleteResponse(BaseModel):
    """
    Response after successfully deleting a subscription.

    Attributes:
        deleted: Whether the subscription was deleted
        message: Status message
    """

    deleted: bool
    message: str = Field(default="Push subscription deleted successfully")


class TestNotificationResponse(BaseModel):
    """
    Response after sending a test notification.

    Attributes:
        sent: Number of notifications successfully sent
        failed: Number of notifications that failed
        message: Status message
    """

    sent: int = Field(ge=0, description="Number of successful sends")
    failed: int = Field(ge=0, description="Number of failed sends")
    message: str = Field(default="Test notification sent")


# ============================================================================
# EXPORTS
# ============================================================================

__all__ = [
    # Request schemas
    "PushSubscriptionKeys",
    "PushSubscriptionCreate",
    "PushSubscriptionUnsubscribe",
    "NotificationAction",
    "PushNotificationPayload",
    "TestNotificationRequest",
    # Response schemas
    "PushSubscriptionResponse",
    "PushSubscriptionListResponse",
    "VAPIDPublicKeyResponse",
    "PushSubscriptionCreateResponse",
    "PushSubscriptionDeleteResponse",
    "TestNotificationResponse",
]
