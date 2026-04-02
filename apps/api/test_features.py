"""End-to-end test of consent flow, agent policy creation, and policy visibility."""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from datetime import date as date_type
from sqlalchemy import text, inspect, delete, select
from app.db import SessionLocal, engine
from app.models import User, Policy
from app.models_agent import AgentClient, AgentPolicyAccess, AgentNote
from app.auth import hash_password

# Create the new table if needed
insp = inspect(engine)
existing_tables = set(insp.get_table_names())
if "agent_policy_access" not in existing_tables:
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE agent_policy_access (
                id SERIAL PRIMARY KEY,
                agent_id INTEGER NOT NULL REFERENCES users(id),
                client_id INTEGER NOT NULL REFERENCES users(id),
                policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
                visible BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT NOW(),
                CONSTRAINT uq_agent_policy UNIQUE (agent_id, policy_id)
            )
        """))
        conn.execute(text("CREATE INDEX ix_apa_agent ON agent_policy_access(agent_id)"))
        conn.execute(text("CREATE INDEX ix_apa_client ON agent_policy_access(client_id)"))
        conn.execute(text("CREATE INDEX ix_apa_policy ON agent_policy_access(policy_id)"))
    print("CREATED agent_policy_access table")
else:
    print("agent_policy_access table already exists")

db = SessionLocal()
errors = []

admin = db.query(User).filter(User.email == "mabergel@me.com").first()
client = db.query(User).filter(User.email == "sarah.westlake@demo.covrabl.com").first()
if not admin or not client:
    print("SKIP: test users not found")
    sys.exit(1)

# Clean up
db.execute(delete(AgentPolicyAccess).where(
    AgentPolicyAccess.agent_id == admin.id,
    AgentPolicyAccess.client_id == client.id,
))
db.execute(delete(AgentClient).where(
    AgentClient.agent_id == admin.id,
    AgentClient.client_id == client.id,
))
db.flush()

# === TEST 1: Consent Flow ===
print("\n=== TEST 1: Consent Flow ===")
rel = AgentClient(agent_id=admin.id, client_id=client.id, status="pending", invited_email=client.email)
db.add(rel)
db.flush()
print(f"  1a. Created pending invite (id={rel.id})")
assert rel.status == "pending"

pending = db.execute(select(AgentClient).where(
    AgentClient.client_id == client.id, AgentClient.status == "pending",
)).scalars().all()
print(f"  1b. Client sees {len(pending)} pending invite(s)")
assert len(pending) >= 1

rel.status = "active"
db.flush()
print(f"  1c. Accepted (status={rel.status})")

pending_after = db.execute(select(AgentClient).where(
    AgentClient.client_id == client.id, AgentClient.status == "pending",
)).scalars().all()
assert len(pending_after) == 0
print("  PASS")

# === TEST 2: Agent Creates Policy ===
print("\n=== TEST 2: Agent Creates Policy ===")
new_policy = Policy(
    user_id=client.id, scope="personal", policy_type="umbrella",
    carrier="Liberty Mutual", policy_number="LM-UMB-TEST",
    coverage_amount=1000000, deductible=0, premium_amount=800,
    renewal_date=date_type(2027, 1, 15), status="active",
)
db.add(new_policy)
db.flush()
print(f"  2a. Created policy id={new_policy.id}")

access = AgentPolicyAccess(
    agent_id=admin.id, client_id=client.id,
    policy_id=new_policy.id, visible=True,
)
db.add(access)
db.flush()
print(f"  2b. Visibility row created")
assert new_policy.user_id == client.id
print("  PASS")

# === TEST 3: Policy Visibility ===
print("\n=== TEST 3: Policy Visibility ===")
all_policies = db.execute(select(Policy).where(Policy.user_id == client.id)).scalars().all()
print(f"  3a. Client has {len(all_policies)} policies")

from app.routes_agent import _ensure_policy_access_rows, _get_visible_policies
_ensure_policy_access_rows(db, admin.id, client.id)
db.flush()

access_rows = db.execute(select(AgentPolicyAccess).where(
    AgentPolicyAccess.agent_id == admin.id,
    AgentPolicyAccess.client_id == client.id,
)).scalars().all()
print(f"  3b. {len(access_rows)} visibility rows")
assert len(access_rows) == len(all_policies), f"Expected {len(all_policies)}, got {len(access_rows)}"

# Hide first policy
first = all_policies[0]
hide = db.execute(select(AgentPolicyAccess).where(
    AgentPolicyAccess.agent_id == admin.id,
    AgentPolicyAccess.policy_id == first.id,
)).scalar_one()
hide.visible = False
db.flush()
print(f"  3c. Hid policy {first.id}")

class MockAgent:
    def __init__(self, id, role):
        self.id = id
        self.role = role

mock = MockAgent(admin.id, "agent")
visible = _get_visible_policies(db, mock, client.id)
print(f"  3d. Visible: {len(visible)} (expected {len(all_policies) - 1})")
assert len(visible) == len(all_policies) - 1
assert first.id not in [p.id for p in visible]

hide.visible = True
db.flush()
visible2 = _get_visible_policies(db, mock, client.id)
assert len(visible2) == len(all_policies)
print("  3e. Unhid — all visible again")
print("  PASS")

# === TEST 4: Delete cascade ===
print("\n=== TEST 4: Delete cascade ===")
test_user = User(email="delete-test-2@demo.covrabl.com", hashed_password=hash_password("test1234"), role="individual")
db.add(test_user)
db.flush()
test_pol = Policy(user_id=test_user.id, scope="personal", policy_type="auto", carrier="Test", policy_number="DEL-TEST", status="active")
db.add(test_pol)
db.flush()
db.add(AgentPolicyAccess(agent_id=admin.id, client_id=test_user.id, policy_id=test_pol.id, visible=True))
db.add(AgentClient(agent_id=admin.id, client_id=test_user.id, status="active", invited_email="delete-test-2@demo.covrabl.com"))
db.flush()

from app.routes_auth import delete_user_cascade
try:
    delete_user_cascade(db, test_user.id)
    db.commit()
    gone = db.query(User).filter(User.email == "delete-test-2@demo.covrabl.com").first()
    assert gone is None
    print("  PASS")
except Exception as e:
    db.rollback()
    print(f"  FAIL: {e}")
    errors.append(str(e))

# Cleanup
db.execute(delete(AgentPolicyAccess).where(
    AgentPolicyAccess.agent_id == admin.id,
    AgentPolicyAccess.client_id == client.id,
))
db.execute(delete(Policy).where(Policy.policy_number == "LM-UMB-TEST"))
# Keep the agent-client relationship active for the demo
db.commit()

print(f"\n{'=' * 30}")
if errors:
    print(f"FAILED: {len(errors)} error(s)")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
else:
    print("ALL 4 TESTS PASSED")

db.close()
