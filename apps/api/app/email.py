import asyncio
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import resend

from .config import settings

logger = logging.getLogger(__name__)


def log_email_send(db, recipient: str, email_type: str, subject: str, status: str = "sent", error: str | None = None):
    """Record an outgoing email in the email_logs table."""
    from .models_admin import EmailLog
    entry = EmailLog(recipient=recipient, email_type=email_type, subject=subject, status=status, error=error)
    db.add(entry)
    db.flush()


def _send_email(to_email: str, subject: str, html_body: str) -> None:
    """Send an email via Resend (preferred) or SMTP fallback."""

    # Try Resend first
    if settings.resend_api_key:
        resend.api_key = settings.resend_api_key
        from_addr = settings.from_email
        if "<" not in from_addr:
            from_addr = f"Covrabl <{from_addr}>"
        result = resend.Emails.send({
            "from": from_addr,
            "to": [to_email],
            "subject": subject,
            "html": html_body,
        })
        logger.info("Resend response for %s: %s", to_email, result)
        return

    # SMTP fallback
    if settings.smtp_host and settings.smtp_user:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.from_email
        msg["To"] = to_email
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.starttls()
            server.login(settings.smtp_user, settings.smtp_password)
            server.sendmail(settings.from_email, to_email, msg.as_string())
        logger.info("Email sent via SMTP to %s", to_email)
        return

    logger.info("SMTP not configured — skipped email to %s (subject: %s)", to_email, subject)


async def send_reset_email(to_email: str, reset_url: str) -> None:
    html = f"""\
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
  <h2 style="color: #1a1a2e; margin-bottom: 16px;">Reset your password</h2>
  <p style="color: #555; line-height: 1.6;">
    We received a request to reset your Covrabl password. Click the button below to choose a new password.
  </p>
  <a href="{reset_url}"
     style="display: inline-block; background: #6c5ce7; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 24px 0;">
    Reset Password
  </a>
  <p style="color: #888; font-size: 13px; line-height: 1.5;">
    This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
  </p>
</body>
</html>"""

    try:
        await asyncio.to_thread(_send_email, to_email, "Reset your Covrabl password", html)
    except Exception:
        logger.exception("Failed to send reset email to %s", to_email)


async def send_share_email(
    to_email: str,
    from_name: str,
    policy_count: int,
    permission: str,
) -> None:
    app_url = settings.app_url.rstrip("/")
    html = f"""\
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
  <h2 style="color: #1a1a2e; margin-bottom: 16px;">Someone shared coverage with you</h2>
  <p style="color: #555; line-height: 1.6;">
    <strong>{from_name}</strong> shared {policy_count} insurance polic{"y" if policy_count == 1 else "ies"} with you on Covrabl ({permission} access).
  </p>
  <p style="color: #555; line-height: 1.6;">
    Sign in or create a free account to view the shared coverage details.
  </p>
  <a href="{app_url}/login"
     style="display: inline-block; background: #1e3a5f; color: #fff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 24px 0;">
    View Shared Policies
  </a>
  <p style="color: #888; font-size: 13px; line-height: 1.5;">
    Use this email address ({to_email}) when creating your account so the shared policies appear automatically.
  </p>
</body>
</html>"""

    try:
        await asyncio.to_thread(
            _send_email, to_email,
            f"{from_name} shared insurance coverage with you on Covrabl",
            html,
        )
    except Exception:
        logger.exception("Failed to send share email to %s", to_email)
