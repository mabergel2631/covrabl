import asyncio
import logging
from collections import defaultdict
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .email import _send_email, log_email_send
from .models import Policy, User
from .models_features import RenewalReminder

logger = logging.getLogger(__name__)


async def send_renewal_reminders(db: Session) -> dict:
    """Send email reminders for renewals that are due today or overdue."""
    today = date.today()

    rows = db.execute(
        select(RenewalReminder, Policy, User)
        .join(Policy, RenewalReminder.policy_id == Policy.id)
        .join(User, Policy.user_id == User.id)
        .where(RenewalReminder.dismissed == False)  # noqa: E712
        .where(RenewalReminder.remind_at <= today)
    ).all()

    if not rows:
        return {"sent": 0, "users": 0}

    # Group by user
    by_user: dict[int, dict] = defaultdict(lambda: {"email": "", "policies": []})
    for reminder, policy, user in rows:
        by_user[user.id]["email"] = user.email
        days_until = (policy.renewal_date - today).days if policy.renewal_date else None
        by_user[user.id]["policies"].append({
            "carrier": policy.carrier,
            "policy_type": policy.policy_type,
            "renewal_date": str(policy.renewal_date) if policy.renewal_date else "Unknown",
            "days_remaining": days_until,
        })

    sent = 0
    for user_id, data in by_user.items():
        policy_rows = ""
        for p in data["policies"]:
            days_label = f"{p['days_remaining']} days" if p["days_remaining"] is not None else "—"
            policy_rows += f"""
            <tr>
              <td style="padding: 10px 12px; border-bottom: 1px solid #eee;">{p['carrier']}</td>
              <td style="padding: 10px 12px; border-bottom: 1px solid #eee;">{p['policy_type']}</td>
              <td style="padding: 10px 12px; border-bottom: 1px solid #eee;">{p['renewal_date']}</td>
              <td style="padding: 10px 12px; border-bottom: 1px solid #eee;">{days_label}</td>
            </tr>"""

        html = f"""\
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; padding: 40px 20px;">
  <h2 style="color: #1a1a2e; margin-bottom: 16px;">Upcoming policy renewals</h2>
  <p style="color: #555; line-height: 1.6;">
    You have {len(data['policies'])} {'policy' if len(data['policies']) == 1 else 'policies'} with upcoming renewals that need your attention.
  </p>
  <table style="width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 14px;">
    <thead>
      <tr style="background: #f8f9fa;">
        <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Carrier</th>
        <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Type</th>
        <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Renewal Date</th>
        <th style="padding: 10px 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Days Left</th>
      </tr>
    </thead>
    <tbody>
      {policy_rows}
    </tbody>
  </table>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 24px 0;">
    <tr>
      <td style="background-color: #2563eb; border-radius: 6px;">
        <a href="{settings.app_url}/policies"
           style="display: inline-block; color: #ffffff; padding: 14px 32px; text-decoration: none; font-weight: 700; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          Review in Covrabl
        </a>
      </td>
    </tr>
  </table>
  <p style="color: #888; font-size: 13px; line-height: 1.5; margin-top: 24px;">
    You're receiving this because you have renewal reminders set up in Covrabl.
  </p>
</body>
</html>"""

        subject = "Covrabl: Upcoming policy renewals"
        try:
            await asyncio.to_thread(_send_email, data["email"], subject, html)
            log_email_send(db, data["email"], "renewal_reminder", subject)
            sent += 1
        except Exception as e:
            logger.exception("Failed to send renewal email to %s", data["email"])
            log_email_send(db, data["email"], "renewal_reminder", subject, "failed", str(e))

    db.commit()
    return {"sent": sent, "users": len(by_user)}
