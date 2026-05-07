"""Phase 2 smoke test — two agents in the same agency see each other's clients;
role enforcement on writes; producer assignment works.

Run:  cd apps/api && DATABASE_URL="sqlite:///./_phase2_smoke.db" .venv/Scripts/python.exe test_phase2_agency.py
"""
import os
import sys

# Force a fresh sandbox DB before any app imports
TEST_DB = os.path.abspath("./_phase2_smoke.db")
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"

# Wipe any prior run
if os.path.exists(TEST_DB):
    os.remove(TEST_DB)

sys.path.insert(0, ".")

# Run alembic to set up the schema
from alembic.config import Config
from alembic import command
cfg = Config("alembic.ini")
cfg.set_main_option("script_location", "alembic")
command.upgrade(cfg, "head")
print("[setup] alembic upgraded to head")

from sqlalchemy import select, text, inspect
from app.db import SessionLocal, engine, Base
from app.models import User
from app.models_agency import Agency, AgencyMember
from app.models_agent import AgentClient
from app.auth import hash_password, create_access_token

# Mirror what main.py startup does after alembic — fill in any tables/columns
# the alembic baseline doesn't cover (legacy tech debt: many tables and a
# few columns are still managed via Base.metadata.create_all + raw ALTERs).
Base.metadata.create_all(bind=engine)
insp = inspect(engine)
with engine.begin() as conn:
    cc_cols = [c["name"] for c in insp.get_columns("compliance_checks")]
    if "report_text" not in cc_cols:
        conn.execute(text("ALTER TABLE compliance_checks ADD COLUMN report_text TEXT"))
    doc_cols = [c["name"] for c in insp.get_columns("documents")]
    if "uploaded_by_user_id" not in doc_cols:
        conn.execute(text("ALTER TABLE documents ADD COLUMN uploaded_by_user_id INTEGER"))
print("[setup] create_all + idempotent column fills done")

db = SessionLocal()

# Seed: 1 agency, 3 agents (owner, producer, viewer), 1 client, 1 agent_client
agency = Agency(name="Acme Insurance", slug="agency-test")
db.add(agency)
db.flush()

owner_user = User(email="owner@acme.test", hashed_password=hash_password("pw"), role="agent")
producer_user = User(email="producer@acme.test", hashed_password=hash_password("pw"), role="agent")
viewer_user = User(email="viewer@acme.test", hashed_password=hash_password("pw"), role="agent")
client_user = User(email="client@example.test", hashed_password=hash_password("pw"), role="individual")
db.add_all([owner_user, producer_user, viewer_user, client_user])
db.flush()

_owner_uid = owner_user.id
_producer_uid = producer_user.id
_viewer_uid = viewer_user.id
_client_uid = client_user.id

owner_member = AgencyMember(agency_id=agency.id, user_id=_owner_uid, role="owner", status="active")
producer_member = AgencyMember(agency_id=agency.id, user_id=_producer_uid, role="producer", status="active")
viewer_member = AgencyMember(agency_id=agency.id, user_id=_viewer_uid, role="viewer", status="active")
db.add_all([owner_member, producer_member, viewer_member])
db.flush()

# Owner-created agent_client relationship for the test client
rel = AgentClient(
    agent_id=_owner_uid,
    client_id=_client_uid,
    agency_id=agency.id,
    status="active",
)
db.add(rel)
db.commit()

OWNER_ID = _owner_uid
PRODUCER_ID = _producer_uid
VIEWER_ID = _viewer_uid
CLIENT_ID = _client_uid
AGENCY_ID = agency.id
OWNER_MEMBER_ID = owner_member.id
PRODUCER_MEMBER_ID = producer_member.id
VIEWER_MEMBER_ID = viewer_member.id
owner_token = create_access_token(OWNER_ID)
producer_token = create_access_token(PRODUCER_ID)
viewer_token = create_access_token(VIEWER_ID)
print(f"[setup] seeded agency {AGENCY_ID} with owner/producer/viewer + 1 client")
db.close()

# Now hit the API via TestClient
from fastapi.testclient import TestClient
from main import app
client = TestClient(app)

def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}

results: list[tuple[str, str]] = []

def expect(test_name: str, ok: bool, detail: str = ""):
    status = "PASS" if ok else "FAIL"
    results.append((status, f"{test_name} — {detail}" if detail else test_name))
    print(f"  [{status}] {test_name}{' — ' + detail if detail else ''}")


# Test 1: Producer (different member than the row's agent_id) sees the client created by Owner
r = client.get("/agent/clients", headers=hdr(producer_token))
ok = r.status_code == 200 and any(c.get("email") == "client@example.test" for c in r.json())
expect("producer sees owner-created client (agency-scoped read)", ok, f"status={r.status_code} body_len={len(r.json()) if r.status_code==200 else r.text[:120]}")

# Test 2: Viewer (different member) ALSO sees the client
r = client.get("/agent/clients", headers=hdr(viewer_token))
ok = r.status_code == 200 and any(c.get("email") == "client@example.test" for c in r.json())
expect("viewer sees client too (read is allowed)", ok, f"status={r.status_code}")

# Test 3: Viewer cannot add a note (write blocked)
r = client.post(
    f"/agent/clients/{CLIENT_ID}/notes",
    headers=hdr(viewer_token),
    json={"content": "should fail"},
)
ok = r.status_code == 403
expect("viewer is forbidden from POST /notes", ok, f"status={r.status_code}")

# Test 4: Producer CAN add a note
r = client.post(
    f"/agent/clients/{CLIENT_ID}/notes",
    headers=hdr(producer_token),
    json={"content": "producer note"},
)
ok = r.status_code == 200
expect("producer can POST /notes", ok, f"status={r.status_code}")

# Test 5: List notes returns the producer's note (and any author info)
r = client.get(f"/agent/clients/{CLIENT_ID}/notes", headers=hdr(owner_token))
notes = r.json() if r.status_code == 200 else []
ok = (
    r.status_code == 200
    and any(n["content"] == "producer note" for n in notes)
    and any(n.get("author_id") == PRODUCER_ID for n in notes)
)
expect("owner sees producer's note (cross-member read)", ok, f"status={r.status_code} notes={len(notes)}")

# Test 6: Producer cannot assign producer (owner-only)
r = client.put(
    f"/agent/clients/{CLIENT_ID}/producer",
    headers=hdr(producer_token),
    json={"producer_member_id": PRODUCER_MEMBER_ID},
)
ok = r.status_code == 403
expect("producer cannot PUT /producer (owner-only)", ok, f"status={r.status_code}")

# Test 7: Owner can assign producer
r = client.put(
    f"/agent/clients/{CLIENT_ID}/producer",
    headers=hdr(owner_token),
    json={"producer_member_id": PRODUCER_MEMBER_ID},
)
ok = r.status_code == 200 and r.json().get("producer_member_id") == PRODUCER_MEMBER_ID
expect("owner assigns producer", ok, f"status={r.status_code}")

# Test 8: list_clients now shows producer_name on the client
r = client.get("/agent/clients", headers=hdr(owner_token))
target = next((c for c in r.json() if c.get("email") == "client@example.test"), None) if r.status_code == 200 else None
ok = (
    r.status_code == 200
    and target is not None
    and target.get("producer_member_id") == PRODUCER_MEMBER_ID
    and target.get("producer_name") in ("producer@acme.test",)  # full_name not set, falls back to email
)
expect("client list includes producer_name", ok, f"got={target}")

# Test 9: Owner can clear producer (producer_member_id=null)
r = client.put(
    f"/agent/clients/{CLIENT_ID}/producer",
    headers=hdr(owner_token),
    json={"producer_member_id": None},
)
ok = r.status_code == 200 and r.json().get("producer_member_id") is None
expect("owner clears producer assignment", ok, f"status={r.status_code}")

# Test 10: Cross-agency leak check — make a SECOND agency with its own client and confirm
# the first agency's members do NOT see it
db = SessionLocal()
agency2 = Agency(name="Other Agency", slug="agency-other")
db.add(agency2); db.flush()
other_owner = User(email="other-owner@other.test", hashed_password=hash_password("pw"), role="agent")
other_client = User(email="other-client@example.test", hashed_password=hash_password("pw"), role="individual")
db.add_all([other_owner, other_client]); db.flush()
db.add(AgencyMember(agency_id=agency2.id, user_id=other_owner.id, role="owner", status="active"))
db.add(AgentClient(
    agent_id=other_owner.id, client_id=other_client.id,
    agency_id=agency2.id, status="active",
))
db.commit()
db.close()

r = client.get("/agent/clients", headers=hdr(owner_token))
emails = [c.get("email") for c in r.json()] if r.status_code == 200 else []
ok = "other-client@example.test" not in emails
expect("agency 1 member does NOT see agency 2's client (no cross-tenant leak)", ok, f"emails={emails}")

# Test 11: GET /agent/agency/me returns the caller's role and agency
r = client.get("/agent/agency/me", headers=hdr(owner_token))
ok = r.status_code == 200 and r.json().get("role") == "owner" and r.json().get("agency_id") == AGENCY_ID
expect("/agency/me returns owner context", ok, f"resp={r.json() if r.status_code==200 else r.text[:80]}")

# Test 12: GET /agent/agency/members returns 3 members in role-priority order
r = client.get("/agent/agency/members", headers=hdr(producer_token))
mlist = r.json() if r.status_code == 200 else []
ok = (
    r.status_code == 200
    and len(mlist) == 3
    and mlist[0]["role"] == "owner"
    and {m["role"] for m in mlist} == {"owner", "producer", "viewer"}
)
expect("/agency/members returns 3 members, owner first", ok, f"len={len(mlist)} roles={[m['role'] for m in mlist]}")

# Test 13: client_summary now includes producer_member_id + producer_name once assigned
# Re-assign producer first since test 9 cleared it
client.put(f"/agent/clients/{CLIENT_ID}/producer", headers=hdr(owner_token), json={"producer_member_id": PRODUCER_MEMBER_ID})
r = client.get(f"/agent/clients/{CLIENT_ID}/summary", headers=hdr(producer_token))
body = r.json() if r.status_code == 200 else {}
ok = (
    r.status_code == 200
    and body.get("producer_member_id") == PRODUCER_MEMBER_ID
    and body.get("producer_name") == "producer@acme.test"
)
expect("client_summary includes producer info", ok, f"got={body.get('producer_member_id')}/{body.get('producer_name')}")

# Test 14: Cross-agency members list — owner of agency 1 should NOT see members of agency 2
r = client.get("/agent/agency/members", headers=hdr(owner_token))
mlist = r.json() if r.status_code == 200 else []
emails = {m.get("email") for m in mlist}
ok = "other-owner@other.test" not in emails
expect("agency 1 members list does NOT include agency 2 owner", ok, f"emails={sorted(emails)}")

# ── Phase 4: Team management ──────────────────────────

# Test 15: Producer cannot invite (owner-only)
r = client.post(
    "/agent/agency/members/invite",
    headers=hdr(producer_token),
    json={"email": "newhire@acme.test", "role": "csr"},
)
ok = r.status_code == 403
expect("producer cannot invite (owner-only)", ok, f"status={r.status_code}")

# Test 16: Owner invites a brand-new email — status='invited' with token
r = client.post(
    "/agent/agency/members/invite",
    headers=hdr(owner_token),
    json={"email": "newhire@acme.test", "role": "csr"},
)
new_member_id = r.json().get("member_id") if r.status_code == 200 else None
ok = r.status_code == 200 and r.json().get("status") == "invited" and r.json().get("role") == "csr"
expect("owner invites new email -> status=invited", ok, f"resp={r.json() if r.status_code==200 else r.text[:120]}")

# Test 17: Members list now shows the invited row
r = client.get("/agent/agency/members", headers=hdr(owner_token))
mlist = r.json() if r.status_code == 200 else []
ok = any(m.get("email") == "newhire@acme.test" and m.get("status") == "invited" for m in mlist)
expect("invited member appears in /agency/members", ok, f"count={len(mlist)}")

# Test 18: Re-inviting same email -> 400
r = client.post(
    "/agent/agency/members/invite",
    headers=hdr(owner_token),
    json={"email": "newhire@acme.test", "role": "viewer"},
)
ok = r.status_code == 400
expect("re-inviting same email is rejected", ok, f"status={r.status_code}")

# Test 19: Owner changes producer's role to csr
r = client.put(
    f"/agent/agency/members/{PRODUCER_MEMBER_ID}/role",
    headers=hdr(owner_token),
    json={"role": "csr"},
)
ok = r.status_code == 200 and r.json().get("role") == "csr"
expect("owner promotes producer -> csr", ok, f"status={r.status_code}")

# Restore for the rest of the test run
client.put(f"/agent/agency/members/{PRODUCER_MEMBER_ID}/role", headers=hdr(owner_token), json={"role": "producer"})

# Test 20: Last-Owner protection on demote
r = client.put(
    f"/agent/agency/members/{OWNER_MEMBER_ID}/role",
    headers=hdr(owner_token),
    json={"role": "viewer"},
)
ok = r.status_code == 400
expect("cannot demote the last Owner", ok, f"status={r.status_code} body={r.text[:80]}")

# Test 21: Owner removes the viewer member
r = client.delete(
    f"/agent/agency/members/{VIEWER_MEMBER_ID}",
    headers=hdr(owner_token),
)
ok = r.status_code == 200 and r.json().get("ok") is True
expect("owner removes viewer", ok, f"status={r.status_code}")

# Test 22: Last-Owner protection on remove
r = client.delete(
    f"/agent/agency/members/{OWNER_MEMBER_ID}",
    headers=hdr(owner_token),
)
ok = r.status_code == 400
expect("cannot remove the last Owner", ok, f"status={r.status_code}")

# Test 23: Owner renames the agency
r = client.put(
    "/agent/agency",
    headers=hdr(owner_token),
    json={"name": "Acme Insurance Group"},
)
ok = r.status_code == 200 and r.json().get("name") == "Acme Insurance Group"
expect("owner renames agency", ok, f"status={r.status_code}")

# Test 24: Cross-tenant: agency 1 owner cannot manage agency 2 members.
# We don't know agency 2's member id without a query, so look it up.
db = SessionLocal()
from app.models_agency import AgencyMember as AM_inner
other_member = db.execute(
    select(AM_inner).where(AM_inner.role == "owner", AM_inner.user_id != _owner_uid)
).scalar_one_or_none()
other_member_id = other_member.id if other_member else None
db.close()

r = client.put(
    f"/agent/agency/members/{other_member_id}/role",
    headers=hdr(owner_token),
    json={"role": "viewer"},
)
ok = r.status_code == 404  # Member exists but is in a different agency, so 404 from agency-scoped lookup
expect("cross-tenant member edits return 404", ok, f"status={r.status_code} target={other_member_id}")

# ── Renewal Review verification (post-agency-model) ───
# This block exercises the renewal-review write paths to confirm the
# phase-2 agency-scoping changes didn't break them.

# Setup: Owner creates two policies for the client — a prior year and a renewing year
prior_payload = {
    "scope": "personal", "policy_type": "Auto", "carrier": "Travelers",
    "policy_number": "TR-001-2024", "coverage_amount": 100000,
    "deductible": 1000, "premium_amount": 1800,
    "renewal_date": "2025-06-01",
}
r = client.post(f"/agent/clients/{CLIENT_ID}/policies", headers=hdr(owner_token), json=prior_payload)
PRIOR_POLICY_ID = r.json().get("policy_id") if r.status_code == 200 else None
expect("create prior-year policy", r.status_code == 200 and PRIOR_POLICY_ID is not None, f"status={r.status_code}")

renewing_payload = {
    "scope": "personal", "policy_type": "Auto", "carrier": "Chubb",
    "policy_number": "CH-001-2025", "coverage_amount": 150000,
    "deductible": 1500, "premium_amount": 2100,
    "renewal_date": "2026-06-01",
}
r = client.post(f"/agent/clients/{CLIENT_ID}/policies", headers=hdr(owner_token), json=renewing_payload)
RENEWING_POLICY_ID = r.json().get("policy_id") if r.status_code == 200 else None
expect("create renewing policy", r.status_code == 200 and RENEWING_POLICY_ID is not None, f"status={r.status_code}")

# Test 25: Link renewal — Owner links the new policy as renewal of the prior
r = client.post(
    f"/agent/clients/{CLIENT_ID}/policies/{RENEWING_POLICY_ID}/link-renewal",
    headers=hdr(owner_token),
    json={"previous_policy_id": PRIOR_POLICY_ID},
)
body = r.json() if r.status_code == 200 else {}
ok = (
    r.status_code == 200
    and body.get("policy", {}).get("id") == RENEWING_POLICY_ID
    and body.get("previous_policy", {}).get("id") == PRIOR_POLICY_ID
    and len(body.get("deltas", [])) > 0  # should detect carrier, coverage, deductible, premium changes
)
expect("link-renewal computes deltas", ok, f"status={r.status_code} deltas={len(body.get('deltas', []))}")

# Test 26: Producer (cross-member) can view the renewal review
r = client.get(f"/agent/policies/{RENEWING_POLICY_ID}/renewal-review", headers=hdr(producer_token))
ok = r.status_code == 200 and len(r.json().get("deltas", [])) > 0
expect("producer reads renewal-review (cross-member)", ok, f"status={r.status_code}")

# Test 27: Producer can update summary text (write role allows producer)
r = client.put(
    f"/agent/policies/{RENEWING_POLICY_ID}/renewal-review",
    headers=hdr(producer_token),
    json={"summary_text": "Premium up 17%; carrier change; deductible up $500. Discuss with client."},
)
ok = r.status_code == 200 and "Premium up" in (r.json().get("summary_text") or "")
expect("producer updates renewal-review summary", ok, f"status={r.status_code}")

# Test 28: Owner generates share token
r = client.post(f"/agent/policies/{RENEWING_POLICY_ID}/renewal-review/share", headers=hdr(owner_token))
SHARE_TOKEN = r.json().get("share_token") if r.status_code == 200 else None
ok = r.status_code == 200 and SHARE_TOKEN and len(SHARE_TOKEN) >= 16
expect("owner generates share token", ok, f"status={r.status_code} token_len={len(SHARE_TOKEN or '')}")

# Test 29: Public renewal-review endpoint resolves the token (no auth)
r = client.get(f"/renewal-review/public/{SHARE_TOKEN}")
body = r.json() if r.status_code == 200 else {}
ok = (
    r.status_code == 200
    and body.get("summary_text", "").startswith("Premium up")
    and len(body.get("deltas", [])) > 0
)
expect("public share token works (read-only)", ok, f"status={r.status_code}")

# Test 30: Owner revokes share token
r = client.delete(f"/agent/policies/{RENEWING_POLICY_ID}/renewal-review/share", headers=hdr(owner_token))
ok = r.status_code == 200
expect("owner revokes share token", ok, f"status={r.status_code}")

# Test 31: Public endpoint with revoked token returns 404
r = client.get(f"/renewal-review/public/{SHARE_TOKEN}")
ok = r.status_code == 404
expect("revoked token returns 404", ok, f"status={r.status_code}")


# Summary
print()
print("=" * 60)
fail_count = sum(1 for s, _ in results if s == "FAIL")
pass_count = sum(1 for s, _ in results if s == "PASS")
print(f"  {pass_count} passed, {fail_count} failed")
sys.exit(0 if fail_count == 0 else 1)
