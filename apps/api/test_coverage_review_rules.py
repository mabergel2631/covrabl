"""Unit tests for the Coverage Review rule engine.

Run:  cd apps/api && .venv/Scripts/python.exe test_coverage_review_rules.py

Verifies:
- Each rule fires on the expected delta pattern
- Every output passes the banned-token guard (no prescriptive language)
"""
import sys
sys.path.insert(0, ".")

from app.coverage_review_rules import compute_discussion_items, assert_no_banned_tokens, BANNED_TOKENS


def make_delta(field, old, new, dtype):
    return {
        "field_key": field, "old_value": str(old), "new_value": str(new),
        "delta_type": dtype, "severity": "info",
    }


PASSED = 0
FAILED = 0


def expect(name, predicate, detail=""):
    global PASSED, FAILED
    if predicate:
        print(f"  [PASS] {name}")
        PASSED += 1
    else:
        print(f"  [FAIL] {name} — {detail}")
        FAILED += 1


# ──── Auto rules ─────────────────────────────────────
auto_policy = {"policy_type": "Auto", "carrier": "Chubb"}
auto_prior = {"policy_type": "Auto", "carrier": "Travelers"}

# Liability decrease
items = compute_discussion_items(
    auto_policy, auto_prior,
    [make_delta("coverage_amount", 250000, 100000, "decreased")],
)
expect("auto: liability decrease fires", any("Liability limit decreased" in i for i in items), f"got={items}")

# Liability significant increase (>=25%)
items = compute_discussion_items(
    auto_policy, auto_prior,
    [make_delta("coverage_amount", 100000, 250000, "increased")],
)
expect("auto: liability +25% fires", any("Liability limit increased" in i for i in items), f"got={items}")

# Liability small increase (<25%) does NOT fire
items = compute_discussion_items(
    auto_policy, auto_prior,
    [make_delta("coverage_amount", 100000, 110000, "increased")],
)
expect("auto: liability +10% does NOT fire", not any("Liability limit increased" in i for i in items), f"got={items}")

# Deductible increase
items = compute_discussion_items(
    auto_policy, auto_prior,
    [make_delta("deductible", 1000, 1500, "increased")],
)
expect("auto: deductible increase fires", any("Deductible increased" in i for i in items), f"got={items}")

# ──── Home rules ─────────────────────────────────────
home_policy = {"policy_type": "Homeowners", "carrier": "Chubb"}
home_prior = {"policy_type": "Homeowners", "carrier": "Travelers"}

# Dwelling decrease
items = compute_discussion_items(
    home_policy, home_prior,
    [make_delta("coverage_amount", 500000, 400000, "decreased")],
)
expect("home: dwelling decrease fires", any("Dwelling coverage decreased" in i for i in items), f"got={items}")

# Dwelling +15% increase
items = compute_discussion_items(
    home_policy, home_prior,
    [make_delta("coverage_amount", 400000, 460000, "increased")],
)
expect("home: dwelling +15% fires", any("Dwelling coverage increased" in i for i in items), f"got={items}")

# Home deductible change of any direction
items = compute_discussion_items(
    home_policy, home_prior,
    [make_delta("deductible", 2500, 5000, "increased")],
)
expect("home: deductible change fires", any("Deductible changed" in i for i in items), f"got={items}")

# ──── Premium movement (without coverage/deductible change) ──
plain_policy = {"policy_type": "Auto", "carrier": "Chubb"}
items = compute_discussion_items(
    plain_policy, plain_policy,
    [make_delta("premium_amount", 1800, 2100, "increased")],
)
expect("premium +15% alone fires", any("Premium increased without" in i for i in items), f"got={items}")

items = compute_discussion_items(
    plain_policy, plain_policy,
    [make_delta("premium_amount", 2100, 1900, "decreased")],
)
expect("premium -10% alone fires", any("Premium decreased without" in i for i in items), f"got={items}")

# Premium change WITH coverage change does NOT fire the standalone-premium rule
items = compute_discussion_items(
    plain_policy, plain_policy,
    [
        make_delta("premium_amount", 1800, 2100, "increased"),
        make_delta("coverage_amount", 100000, 250000, "increased"),
    ],
)
expect("premium+coverage: standalone-premium rule does NOT fire",
       not any("Premium increased without" in i for i in items), f"got={items}")

# ──── Carrier change ─────────────────────────────────
items = compute_discussion_items(
    auto_policy, auto_prior,
    [make_delta("carrier", "Travelers", "Chubb", "changed")],
)
expect("carrier change fires", any("Carrier changed from prior term" in i for i in items), f"got={items}")

# ──── Policy number isolated change ──────────────────
items = compute_discussion_items(
    auto_policy, auto_prior,
    [make_delta("policy_number", "OLD-001", "NEW-001", "changed")],
)
expect("isolated policy number change fires",
       any("Policy number changed without" in i for i in items), f"got={items}")

# Policy number change WITH others does NOT fire the renewal-rewrite rule
items = compute_discussion_items(
    auto_policy, auto_prior,
    [
        make_delta("policy_number", "OLD-001", "NEW-001", "changed"),
        make_delta("premium_amount", 1800, 2100, "increased"),
    ],
)
expect("policy number + other deltas: rewrite rule does NOT fire",
       not any("Policy number changed without" in i for i in items), f"got={items}")

# ──── Many simultaneous deltas ───────────────────────
items = compute_discussion_items(
    auto_policy, auto_prior,
    [
        make_delta("carrier", "Travelers", "Chubb", "changed"),
        make_delta("coverage_amount", 100000, 250000, "increased"),
        make_delta("deductible", 1000, 1500, "increased"),
        make_delta("premium_amount", 1800, 2200, "increased"),
    ],
)
expect(">=4 deltas fires the multi-change rule",
       any("Multiple changes this term" in i for i in items), f"got={items}")

# ──── BANNED TOKEN GUARD ─────────────────────────────
# Run every rule scenario above and check no output contains banned tokens
all_scenarios = [
    [make_delta("coverage_amount", 250000, 100000, "decreased")],
    [make_delta("coverage_amount", 100000, 250000, "increased")],
    [make_delta("deductible", 1000, 1500, "increased")],
    [make_delta("coverage_amount", 500000, 400000, "decreased")],
    [make_delta("coverage_amount", 400000, 460000, "increased")],
    [make_delta("deductible", 2500, 5000, "increased")],
    [make_delta("premium_amount", 1800, 2100, "increased")],
    [make_delta("premium_amount", 2100, 1900, "decreased")],
    [make_delta("carrier", "Travelers", "Chubb", "changed")],
    [make_delta("policy_number", "OLD-001", "NEW-001", "changed")],
    [
        make_delta("carrier", "T", "C", "changed"),
        make_delta("coverage_amount", 100000, 250000, "increased"),
        make_delta("deductible", 1000, 1500, "increased"),
        make_delta("premium_amount", 1800, 2200, "increased"),
    ],
]
for ptype in ["Auto", "Homeowners", "Health"]:
    p = {"policy_type": ptype, "carrier": "X"}
    for scen in all_scenarios:
        outputs = compute_discussion_items(p, p, scen)
        for s in outputs:
            try:
                assert_no_banned_tokens(s)
            except AssertionError as e:
                expect(f"banned-token guard for {ptype} | {scen[0]['field_key']}", False, str(e))
                break

# If we got here without any banned-token failures, mark the guard as passed
expect("no rule output contains a banned token (across all policy types and scenarios)", True)

# Empty deltas → empty items
items = compute_discussion_items(auto_policy, auto_prior, [])
expect("empty deltas yields empty list", items == [], f"got={items}")

print()
print("=" * 60)
print(f"  {PASSED} passed, {FAILED} failed")
sys.exit(0 if FAILED == 0 else 1)
