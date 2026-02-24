"""Email service — фасад для отправки email через абстрактного провайдера."""

import logging

from .provider import EmailProvider

logger = logging.getLogger(__name__)


class EmailService:
    """Фасад для отправки email через абстрактного провайдера."""

    def __init__(self, provider: EmailProvider) -> None:
        self._provider = provider

    async def send_password_reset_email(self, to_email: str, reset_url: str) -> bool:
        """Отправляет email для сброса пароля."""
        subject = "Сброс пароля — fancai"
        html_body = self._render_reset_template(reset_url)
        text_body = f"Для сброса пароля перейдите по ссылке: {reset_url}\nСсылка действительна 30 минут."
        return await self._provider.send_email(to_email, subject, html_body, text_body)

    async def send_password_changed_confirmation(self, to_email: str) -> bool:
        """OWASP: отправляет уведомление об успешной смене пароля."""
        subject = "Пароль изменён — fancai"
        html_body = self._render_password_changed_template()
        text_body = "Ваш пароль в fancai был успешно изменён. Если вы не делали этого, немедленно свяжитесь с поддержкой."
        return await self._provider.send_email(to_email, subject, html_body, text_body)

    def _render_reset_template(self, reset_url: str) -> str:
        """Рендерит HTML email шаблон для сброса пароля."""
        return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;padding:40px;">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <h1 style="color:#18181b;font-size:24px;margin:0;">fancai</h1>
            </td>
          </tr>
          <tr>
            <td style="color:#3f3f46;font-size:16px;line-height:24px;padding-bottom:24px;">
              Вы запросили сброс пароля. Нажмите кнопку ниже, чтобы установить новый пароль:
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <a href="{reset_url}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#7c3aed;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:16px;font-weight:600;">
                Сбросить пароль
              </a>
            </td>
          </tr>
          <tr>
            <td style="color:#71717a;font-size:14px;line-height:20px;padding-bottom:16px;">
              Ссылка действительна 30 минут. Если вы не запрашивали сброс пароля, проигнорируйте это письмо.
            </td>
          </tr>
          <tr>
            <td style="color:#a1a1aa;font-size:12px;border-top:1px solid #e4e4e7;padding-top:16px;">
              Если кнопка не работает, скопируйте ссылку: {reset_url}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""

    def _render_password_changed_template(self) -> str:
        """Рендерит HTML шаблон уведомления о смене пароля (OWASP confirmation)."""
        return """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;padding:40px;">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <h1 style="color:#18181b;font-size:24px;margin:0;">fancai</h1>
            </td>
          </tr>
          <tr>
            <td style="color:#3f3f46;font-size:16px;line-height:24px;padding-bottom:24px;">
              Ваш пароль был успешно изменён.
            </td>
          </tr>
          <tr>
            <td style="color:#ef4444;font-size:14px;line-height:20px;padding-bottom:16px;font-weight:600;">
              Если вы не меняли пароль, немедленно свяжитесь с поддержкой — ваш аккаунт мог быть скомпрометирован.
            </td>
          </tr>
          <tr>
            <td style="color:#a1a1aa;font-size:12px;border-top:1px solid #e4e4e7;padding-top:16px;">
              Это автоматическое уведомление от fancai.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""
