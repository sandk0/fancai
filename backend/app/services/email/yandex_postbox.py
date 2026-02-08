"""Yandex Cloud Postbox provider (AWS SES v2 compatible)."""

import logging
from typing import Optional

import aioboto3
from botocore.config import Config as BotoConfig

from ...core.config import settings

logger = logging.getLogger(__name__)


class YandexPostboxProvider:
    """Yandex Cloud Postbox — SES v2-compatible email provider."""

    def __init__(self) -> None:
        self._session = aioboto3.Session()

    async def send_email(
        self,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
    ) -> bool:
        """Отправляет email через Yandex Cloud Postbox."""
        boto_config = BotoConfig(
            region_name=settings.YANDEX_POSTBOX_REGION,
            retries={"max_attempts": 3, "mode": "adaptive"},
        )
        try:
            async with self._session.client(
                "sesv2",
                endpoint_url=settings.YANDEX_POSTBOX_ENDPOINT,
                aws_access_key_id=settings.YANDEX_POSTBOX_ACCESS_KEY,
                aws_secret_access_key=settings.YANDEX_POSTBOX_SECRET_KEY,
                config=boto_config,
            ) as client:
                body: dict = {"Html": {"Data": html_body}}
                if text_body:
                    body["Text"] = {"Data": text_body}

                await client.send_email(
                    FromEmailAddress=f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM}>",
                    Destination={"ToAddresses": [to_email]},
                    Content={
                        "Simple": {
                            "Subject": {"Data": subject},
                            "Body": body,
                        }
                    },
                )
                logger.info(f"Email sent to {to_email}: {subject}")
                return True
        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {e}")
            return False
