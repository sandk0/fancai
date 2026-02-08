"""Log-only email provider для development."""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


class LogEmailProvider:
    """Провайдер для разработки — только логирует email."""

    async def send_email(
        self,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
    ) -> bool:
        """Логирует email вместо отправки."""
        logger.info(f"[DEV EMAIL] To: {to_email} | Subject: {subject}")
        logger.debug(f"[DEV EMAIL] Body: {html_body[:500]}")
        return True
