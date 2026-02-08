"""Protocol для email-провайдеров."""

from typing import Protocol, Optional


class EmailProvider(Protocol):
    """Protocol для отправки email через разных провайдеров."""

    async def send_email(
        self,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
    ) -> bool:
        """Отправляет email. Возвращает True при успехе."""
        ...
