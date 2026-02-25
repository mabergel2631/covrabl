# Admin Dashboard — Full Platform Control Panel

## Context

The current admin dashboard (`/admin`) is read-only: stats cards, a user list, and an activity feed. You want real control — managing users, viewing all platform activity, seeing emails the system sends, managing pending content, communicating with users via banners, and granting admin access to others. This plan transforms the admin page from a "view-only dashboard" into a full operations console.

---

## What Gets Built — 6 Tabs

The admin page becomes a **tabbed interface** with 6 sections:

### Tab 1: Overview (enhanced current stats)
- Keep existing: total users, recent signups, total policies, pending drafts, plan breakdown, signup chart
- **Add**: total documents, estimated storage, approximate active sessions (users seen in last 15 min), MRR breakdown by plan (basic × $9/mo, pro × $29/mo)

### Tab 2: Users (full management — this is where you add other admins)
- Keep existing: searchable user list with pagination, expandable detail rows
- **Add inline actions per user** via dropdown menu:
  - **Change role** → select individual / agent / admin ← *this is how you grant admin access*
  - **Change plan** → select trial / free / basic / pro
  - **Extend trial** → input number of days to add
  - **Suspend / Unsuspend** → toggle (new `is_suspended` field on User model; suspended users can't log in)
  - **Send password reset** → triggers reset email on behalf of user
  - **Delete account** → confirmation modal, reuses existing cascade deletion logic
- Safety: admins cannot change their own role, suspend themselves, or delete themselves

### Tab 3: Activity (full audit log)
- Paginated view of the existing `AuditLog` table (already records all user actions)
- **Filter bar**: user email search, action type dropdown, entity type dropdown, date range
- Each row: timestamp, user email, action badge, entity type, entity ID, details preview (expandable)

### Tab 4: Emails (all outgoing email log)
- **New `EmailLog` model** tracks every email the platform sends (password resets, share notifications, renewal reminders)
- Filter by email type, search by recipient
- Each row: recipient, type badge, subject, status (sent/failed), timestamp
- Read-only view — just visibility into what the system is sending

### Tab 5: Drafts (pending policy draft queue)
- View all `PolicyDraft` records across all users
- Filter by status (pending / approved / rejected)
- **Admin can approve or reject** drafts directly — approved drafts create policies under the original user's account
- Each row: user email, carrier, policy type, filename, status, created_at

### Tab 6: Announcements (site-wide banners)
- **New `Announcement` model** — admin creates banners that all users see
- CRUD: create, edit, toggle active/inactive, delete
- Fields: title, message, type (info / warning / maintenance), date range (auto-show/hide)
- **AppShell shows a dismissible banner** at top when announcements are active
- Also visible on landing page (public endpoint, no auth needed) for maintenance notices

---

## New Database Models

### `EmailLog` (new file: `apps/api/app/models_admin.py`)
| Column | Type | Notes |
|--------|------|-------|
| id | int PK | |
| recipient | string(255) | indexed |
| email_type | string(50) | `password_reset`, `share_notification`, `renewal_reminder` |
| subject | string(500) | |
| status | string(20) | `sent` or `failed` |
| error | text, nullable | error message if failed |
| created_at | datetime | |

### `Announcement` (same file)
| Column | Type | Notes |
|--------|------|-------|
| id | int PK | |
| title | string(200) | |
| message | text | |
| type | string(20) | `info`, `warning`, `maintenance` |
| is_active | bool | default true |
| starts_at | datetime, nullable | auto-show after this time |
| ends_at | datetime, nullable | auto-hide after this time |
| created_by | int FK→users.id | |
| created_at | datetime | |

### `User` model change
- Add `is_suspended: bool = False` column
- Add startup migration in `main.py` (same pattern as existing column migrations)
- `get_current_user` in `auth.py` checks suspension and returns 403

---

## New Backend Endpoints (all in `apps/api/app/routes_admin.py`)

| Method | Path | Purpose |
|--------|------|---------|
| PATCH | `/admin/users/{id}/role` | Change user role (body: `{role}`) |
| PATCH | `/admin/users/{id}/plan` | Change user plan (body: `{plan}`) |
| PATCH | `/admin/users/{id}/extend-trial` | Add days to trial (body: `{days}`) |
| PATCH | `/admin/users/{id}/suspend` | Suspend/unsuspend (body: `{suspended}`) |
| POST | `/admin/users/{id}/send-reset` | Send password reset email for user |
| DELETE | `/admin/users/{id}` | Delete user account (full cascade) |
| GET | `/admin/audit-logs` | Paginated audit log with filters |
| GET | `/admin/audit-logs/filters` | Distinct action/entity_type values for dropdowns |
| GET | `/admin/emails` | Paginated email log with filters |
| GET | `/admin/drafts` | Paginated drafts across all users |
| POST | `/admin/drafts/{id}/approve` | Approve a pending draft |
| POST | `/admin/drafts/{id}/reject` | Reject a pending draft |
| GET | `/admin/announcements` | List all announcements |
| POST | `/admin/announcements` | Create announcement |
| PATCH | `/admin/announcements/{id}` | Update announcement |
| DELETE | `/admin/announcements/{id}` | Delete announcement |

**Public (separate router, no auth):**
| GET | `/announcements/active` | Active announcements for banner display |

**Modified existing:**
| GET | `/admin/stats` | Add document count, storage estimate, active sessions, MRR |
| GET | `/admin/users` | Add `is_suspended`, `trial_ends_at` to response |

---

## Email Logging Integration

Add a `log_email_send(db, recipient, email_type, subject, status, error)` helper to `email.py`. Call it from:
- `routes_auth.py` — after `send_reset_email` (type: `password_reset`)
- `routes_sharing.py` — after `send_share_email` (type: `share_notification`)
- `email_renewals.py` — after each renewal email (type: `renewal_reminder`)

---

## Cascade Deletion Refactor

Extract the deletion logic from `routes_auth.py` `delete_account` into a shared helper `delete_user_cascade(db, uid)` so both the user's self-delete and the admin delete endpoint can reuse it.

---

## Files to Create / Modify (18 files)

### New Files (7)
| File | Purpose |
|------|---------|
| `apps/api/app/models_admin.py` | `EmailLog` and `Announcement` models |
| `apps/web/src/app/admin/AdminOverviewTab.tsx` | Overview stats tab |
| `apps/web/src/app/admin/AdminUsersTab.tsx` | User management tab |
| `apps/web/src/app/admin/AdminActivityTab.tsx` | Audit log tab |
| `apps/web/src/app/admin/AdminEmailsTab.tsx` | Email log tab |
| `apps/web/src/app/admin/AdminDraftsTab.tsx` | Drafts queue tab |
| `apps/web/src/app/admin/AdminAnnouncementsTab.tsx` | Announcements CRUD tab |

### Modified Files (11)
| File | Changes |
|------|---------|
| `apps/api/app/models.py` | Add `is_suspended` to User |
| `apps/api/app/auth.py` | Check `is_suspended` in `get_current_user` |
| `apps/api/app/routes_admin.py` | Add ~17 new endpoints, enhance stats + users |
| `apps/api/app/routes_auth.py` | Extract cascade helper, add email logging |
| `apps/api/app/email.py` | Add `log_email_send` helper |
| `apps/api/app/routes_sharing.py` | Add email logging after share email |
| `apps/api/app/email_renewals.py` | Add email logging after renewal emails |
| `apps/api/main.py` | Import new models, add migrations, register announcements router |
| `apps/web/lib/api.ts` | Add ~15 new types + ~15 new adminApi methods + `fetchActiveAnnouncements` |
| `apps/web/src/app/admin/page.tsx` | Refactor to tabbed layout importing 6 tab components |
| `apps/web/src/app/components/AppShell.tsx` | Fetch + display announcement banner |

---

## Implementation Order

### Phase 1: Foundation
1. Create `models_admin.py` (EmailLog, Announcement)
2. Add `is_suspended` to User model + migration in `main.py`
3. Add suspension check in `auth.py`
4. Extract `delete_user_cascade` helper from `routes_auth.py`

### Phase 2: Email Logging
5. Add `log_email_send` to `email.py`
6. Wire logging into `routes_auth.py`, `routes_sharing.py`, `email_renewals.py`

### Phase 3: Backend Endpoints
7. Enhance `GET /admin/stats` and `GET /admin/users`
8. Add user management endpoints (role, plan, trial, suspend, reset, delete)
9. Add audit log endpoints
10. Add email log endpoint
11. Add drafts management endpoints
12. Add announcement CRUD + public active endpoint
13. Register public announcements router in `main.py`

### Phase 4: Frontend API Client
14. Add all new types and methods to `api.ts`

### Phase 5: Frontend Tabs
15. Create `AdminOverviewTab.tsx` (extract from current page)
16. Create `AdminUsersTab.tsx` (extract + add actions dropdown)
17. Create `AdminActivityTab.tsx`
18. Create `AdminEmailsTab.tsx`
19. Create `AdminDraftsTab.tsx`
20. Create `AdminAnnouncementsTab.tsx`
21. Refactor `page.tsx` to tabbed layout

### Phase 6: Announcements Banner
22. Add announcement banner to `AppShell.tsx`

---

## Verification

1. **Users tab**: Search for a user → change their role to admin → they can now see `/admin`. Change back to individual → they lose access.
2. **Suspend**: Suspend a user → try logging in as them → see 403 "Account suspended". Unsuspend → login works again.
3. **Delete**: Delete a test user from admin → all their data is gone, login fails.
4. **Activity tab**: Perform actions as a user (upload document, create policy) → see them appear in the audit log with correct filters.
5. **Emails tab**: Trigger a password reset → see the email logged with recipient, type, status.
6. **Drafts tab**: With a pending draft → approve from admin → policy created under the user's account.
7. **Announcements**: Create an announcement → see banner appear in AppShell for all logged-in users. Toggle inactive → banner disappears. Set end date in the past → banner disappears.
8. **Landing page**: Create a "maintenance" announcement → visit `/` logged out → banner visible.
