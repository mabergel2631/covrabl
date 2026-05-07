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


# Summary
print()
print("=" * 60)
fail_count = sum(1 for s, _ in results if s == "FAIL")
pass_count = sum(1 for s, _ in results if s == "PASS")
print(f"  {pass_count} passed, {fail_count} failed")
sys.exit(0 if fail_count == 0 else 1)
