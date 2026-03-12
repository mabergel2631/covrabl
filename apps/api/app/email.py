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
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 24px 0;">
    <tr>
      <td style="background-color: #2563eb; border-radius: 6px;">
        <a href="{reset_url}"
           style="display: inline-block; color: #ffffff; padding: 14px 32px; text-decoration: none; font-weight: 700; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          Reset Password
        </a>
      </td>
    </tr>
  </table>
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
    _raw_url = settings.app_url.rstrip("/")
    app_url = _raw_url if "localhost" not in _raw_url and "127.0.0.1" not in _raw_url else "https://covrabl.vercel.app"
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
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 24px 0;">
    <tr>
      <td style="background-color: #2563eb; border-radius: 6px;">
        <a href="{app_url}/login"
           style="display: inline-block; color: #ffffff; padding: 14px 32px; text-decoration: none; font-weight: 700; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          View Shared Policies
        </a>
      </td>
    </tr>
  </table>
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


async def send_lease_requirements_email(
    to_email: str,
    from_name: str,
    property_address: str | None,
    public_url: str,
    notes: str | None = None,
) -> None:
    """Sent to tenant when landlord shares a requirements link."""
    location = f" for {property_address}" if property_address else ""
    notes_html = ""
    if notes and notes.strip():
        import html as html_mod
        safe_notes = html_mod.escape(notes.strip()).replace("\n", "<br>")
        notes_html = f"""
  <div style="background: #f8f9fa; border-left: 3px solid #1e3a5f; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
    <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: #6b7280;">Note from {html_mod.escape(from_name)}:</p>
    <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.6;">{safe_notes}</p>
  </div>"""
    html = f"""\
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
  <h2 style="color: #1a1a2e; margin-bottom: 16px;">Lease Insurance Requirements</h2>
  <p style="color: #555; line-height: 1.6;">
    <strong>{from_name}</strong> shared lease insurance requirements{location} with you on Covrabl.
  </p>
  <p style="color: #555; line-height: 1.6;">
    Review the requirements and upload your Certificate of Insurance to verify compliance.
  </p>{notes_html}
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 24px 0;">
    <tr>
      <td style="background-color: #2563eb; border-radius: 6px;">
        <a href="{public_url}"
           style="display: inline-block; color: #ffffff; padding: 14px 32px; text-decoration: none; font-weight: 700; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          View Requirements
        </a>
      </td>
    </tr>
  </table>
  <p style="color: #888; font-size: 13px; line-height: 1.5;">
    No account is needed to view requirements or submit your certificate.
  </p>
</body>
</html>"""

    try:
        await asyncio.to_thread(
            _send_email, to_email,
            f"{from_name} shared lease insurance requirements with you",
            html,
        )
    except Exception:
        logger.exception("Failed to send lease requirements email to %s", to_email)


async def send_coi_submission_email(
    to_email: str,
    tenant_name: str,
    property_address: str | None,
    pass_count: int,
    fail_count: int,
    unclear_count: int,
    review_url: str,
    notes: str | None = None,
) -> None:
    """Sent to landlord when tenant submits COI via public link."""
    location = f" for {property_address}" if property_address else ""
    summary = f"{pass_count} pass, {fail_count} fail, {unclear_count} unclear"
    notes_html = ""
    if notes and notes.strip():
        import html as html_mod
        safe_notes = html_mod.escape(notes.strip()).replace("\n", "<br>")
        safe_tenant = html_mod.escape(tenant_name)
        notes_html = f"""
  <div style="background: #f8f9fa; border-left: 3px solid #1e3a5f; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
    <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: #6b7280;">Note from {safe_tenant}:</p>
    <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.6;">{safe_notes}</p>
  </div>"""
    html = f"""\
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
  <h2 style="color: #1a1a2e; margin-bottom: 16px;">Proof of Insurance Submitted</h2>
  <p style="color: #555; line-height: 1.6;">
    <strong>{tenant_name}</strong> submitted proof of insurance{location}.
  </p>
  <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <p style="margin: 0; font-size: 14px; color: #333; font-weight: 600;">Compliance Summary: {summary}</p>
  </div>{notes_html}
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 24px 0;">
    <tr>
      <td style="background-color: #2563eb; border-radius: 6px;">
        <a href="{review_url}"
           style="display: inline-block; color: #ffffff; padding: 14px 32px; text-decoration: none; font-weight: 700; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          Review Results
        </a>
      </td>
    </tr>
  </table>
</body>
</html>"""

    try:
        await asyncio.to_thread(
            _send_email, to_email,
            f"{tenant_name} submitted proof of insurance",
            html,
        )
    except Exception:
        logger.exception("Failed to send COI submission email to %s", to_email)


async def send_deficiency_notice_email(
    to_email: str,
    tenant_name: str,
    landlord_name: str,
    property_address: str | None,
    failed_items: list[dict],
    notes: str | None,
    resubmit_url: str,
) -> None:
    """Sent to tenant when landlord flags compliance failures."""
    import html as html_mod

    location = f" for {property_address}" if property_address else ""
    safe_landlord = html_mod.escape(landlord_name)

    items_html = ""
    for item in failed_items:
        label = html_mod.escape(item.get("label", ""))
        note = html_mod.escape(item.get("note", ""))
        items_html += f"""
  <div style="border-left: 3px solid #ef4444; padding: 8px 14px; margin: 8px 0; background: #fef2f2; border-radius: 4px;">
    <p style="margin: 0; font-weight: 600; font-size: 14px; color: #991b1b;">{label}</p>
    {f'<p style="margin: 4px 0 0; font-size: 13px; color: #7f1d1d;">{note}</p>' if note else ''}
  </div>"""

    notes_html = ""
    if notes and notes.strip():
        safe_notes = html_mod.escape(notes.strip()).replace("\n", "<br>")
        notes_html = f"""
  <div style="background: #f8f9fa; border-left: 3px solid #1e3a5f; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
    <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: #6b7280;">Message from {safe_landlord}:</p>
    <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.6;">{safe_notes}</p>
  </div>"""

    html = f"""\
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
  <h2 style="color: #1a1a2e; margin-bottom: 16px;">Insurance Compliance Update</h2>
  <p style="color: #555; line-height: 1.6;">
    Your proof of insurance{location} did not meet all of the lease requirements. Please review the items below and submit an updated certificate.
  </p>
  <h3 style="color: #991b1b; font-size: 15px; margin: 20px 0 8px;">Requirements Not Met</h3>
  {items_html}{notes_html}
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 24px 0;">
    <tr>
      <td style="background-color: #2563eb; border-radius: 6px;">
        <a href="{resubmit_url}"
           style="display: inline-block; color: #ffffff; padding: 14px 32px; text-decoration: none; font-weight: 700; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          Resubmit Certificate
        </a>
      </td>
    </tr>
  </table>
</body>
</html>"""

    try:
        await asyncio.to_thread(
            _send_email, to_email,
            f"Insurance compliance update{location}",
            html,
        )
    except Exception:
        logger.exception("Failed to send deficiency notice to %s", to_email)


async def send_landlord_compliance_email(
    to_email: str,
    landlord_name: str,
    tenant_name: str,
    property_address: str | None,
    pass_count: int,
    fail_count: int,
    unclear_count: int,
    notes: str | None = None,
) -> None:
    """Sent to landlord when tenant shares compliance results."""
    import html as html_mod
    location = f" for {property_address}" if property_address else ""
    summary = f"{pass_count} pass, {fail_count} fail, {unclear_count} unclear"
    status = "All requirements met" if fail_count == 0 and unclear_count == 0 else f"{fail_count} requirement(s) need attention"
    notes_html = ""
    if notes and notes.strip():
        safe_notes = html_mod.escape(notes.strip()).replace("\n", "<br>")
        safe_tenant = html_mod.escape(tenant_name)
        notes_html = f"""
  <div style="background: #f8f9fa; border-left: 3px solid #1e3a5f; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
    <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: #6b7280;">Note from {safe_tenant}:</p>
    <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.6;">{safe_notes}</p>
  </div>"""
    html = f"""\
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
  <h2 style="color: #1a1a2e; margin-bottom: 16px;">Insurance Compliance Results</h2>
  <p style="color: #555; line-height: 1.6;">
    <strong>{html_mod.escape(tenant_name)}</strong> has shared their insurance compliance results{location}.
  </p>
  <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; margin: 16px 0;">
    <p style="margin: 0; font-size: 14px; color: #333; font-weight: 600;">Compliance Summary: {summary}</p>
    <p style="margin: 4px 0 0; font-size: 13px; color: #555;">{status}</p>
  </div>{notes_html}
  <p style="color: #888; font-size: 13px; line-height: 1.5;">
    This report was generated by Covrabl, an insurance document management platform.
  </p>
</body>
</html>"""

    try:
        await asyncio.to_thread(
            _send_email, to_email,
            f"{tenant_name} shared insurance compliance results",
            html,
        )
    except Exception:
        logger.exception("Failed to send landlord compliance email to %s", to_email)
