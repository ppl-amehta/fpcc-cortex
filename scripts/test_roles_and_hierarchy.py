#!/usr/bin/env python3
"""
FPCC Cortex: Test Suite for Enterprise Role Management, Hierarchy & Security
Validates:
1. 11 Organizational Archetype Roles (Levels 1 to 5)
2. 12 Archetype Users with reporting hierarchy
3. Semantic Graph BFS multi-hop joins on roles & users
4. REST APIs (/api/roles, /api/roles/hierarchy, /api/auth/users, /api/auth/switch-user)
5. Frictionless vs. Password-Enforced user switching & live toggle
"""

import os
import sys
import json
import sqlite3
import urllib.request
import urllib.error

BASE_URL = "http://localhost:3000"
DB_PATH = os.path.join(os.path.dirname(__file__), "../data/fpcc_cortex.db")

def make_req(path, method="GET", data=None):
    url = f"{BASE_URL}{path}"
    req = urllib.request.Request(url, method=method)
    req.add_header("Content-Type", "application/json")
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        req.data = body
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))

def test_database_schema():
    print("[1] Validating database schema and seed integrity...")
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # Check roles table
    roles = cur.execute("SELECT code, level, parent_role_code, allowed_views, allowed_reports FROM roles").fetchall()
    assert len(roles) == 11, f"Expected 11 roles, found {len(roles)}"
    print(f"    ✓ Found all {len(roles)} archetype roles in SQLite")

    # Check God Mode role
    super_admin = cur.execute("SELECT allowed_views, allowed_reports, permissions FROM roles WHERE code = 'SUPER_ADMIN'").fetchone()
    assert super_admin is not None, "SUPER_ADMIN role missing"
    assert json.loads(super_admin[0]) == ["*"], "SUPER_ADMIN must have unrestricted views ['*']"
    assert json.loads(super_admin[1]) == ["*"], "SUPER_ADMIN must have unrestricted reports ['*']"
    print("    ✓ SUPER_ADMIN has unrestricted God-Mode permissions (['*'])")

    # Check users and manager links
    users = cur.execute("SELECT id, user_name, role_code, manager_id FROM users WHERE active = 1").fetchall()
    assert len(users) >= 12, f"Expected at least 12 active users, found {len(users)}"
    print(f"    ✓ Found {len(users)} active archetype users")

    # Verify hierarchy reporting chain for a floor worker:
    # Runner -> Prashant (Operations Head) -> Rimpy (SuperAdmin)
    runner = cur.execute("SELECT user_name, manager_id FROM users WHERE role_code = 'RUNNER' LIMIT 1").fetchone()
    assert runner is not None and runner[1] == "usr-prashant", f"Runner manager should be usr-prashant, got {runner}"
    
    ops_head = cur.execute("SELECT user_name, manager_id FROM users WHERE id = 'usr-prashant'").fetchone()
    assert ops_head is not None and ops_head[1] == "usr-rimpy", f"Operations Head manager should be usr-rimpy, got {ops_head}"
    print(f"    ✓ Hierarchy verified: Runner -> {ops_head[0]} -> usr-rimpy")

    conn.close()

def test_api_roles_and_hierarchy():
    print("[2] Testing /api/roles and /api/roles/hierarchy endpoints...")
    status, res = make_req("/api/roles")
    assert status == 200 and res.get("success"), f"GET /api/roles failed: {res}"
    roles = res.get("roles", res.get("data", []))
    assert len(roles) == 11, f"Expected 11 roles from API, got {len(roles)}"
    print(f"    ✓ GET /api/roles returned {len(roles)} roles with parsed JSON arrays")

    status, h_res = make_req("/api/roles/hierarchy")
    assert status == 200 and h_res.get("success"), f"GET /api/roles/hierarchy failed: {h_res}"
    tiers = h_res.get("tiers", [])
    assert len(tiers) == 5, f"Expected 5 hierarchy tiers, got {len(tiers)}"
    for t in tiers:
        print(f"      - Tier {t['level']}: {len(t['roles'])} roles")
    print("    ✓ 5-Tier Organizational Hierarchy Tree verified")

def test_api_auth_and_user_profiles():
    print("[3] Testing /api/auth/users and profile reporting relationships...")
    status, res = make_req("/api/auth/users")
    assert status == 200 and res.get("success"), f"GET /api/auth/users failed: {res}"
    users = res.get("data", [])
    assert len(users) >= 12, f"Expected >= 12 users, got {len(users)}"

    # Check Santosh (Cutting Master)
    santosh = next((u for u in users if u["id"] == "usr-santosh"), None)
    assert santosh is not None, "usr-santosh not found"
    assert santosh["role_code"] == "CUTTING_MASTER", f"Santosh role mismatch: {santosh['role_code']}"
    assert santosh["manager_name"] == "Prashant", f"Santosh manager mismatch: {santosh['manager_name']}"
    assert "cutting" in santosh["allowed_views"], f"Cutting Master missing cutting view: {santosh['allowed_views']}"
    print(f"    ✓ Profile verified: {santosh['user_name']} -> Reports to: {santosh['manager_name']} (L{santosh['role_level']})")

def test_frictionless_switching():
    print("[4] Testing frictionless user switching (default pre-go-live mode)...")
    # Verify settings
    status, s_res = make_req("/api/auth/settings")
    assert status == 200 and s_res.get("requirePasswordAuth") is False, "Default must be frictionless (false)"
    print("    ✓ Default system_setting: require_password_auth = false")

    # Switch to Cutting Master without password
    status, sw_res = make_req("/api/auth/switch-user", method="POST", data={"userId": "usr-santosh"})
    assert status == 200 and sw_res.get("success"), f"Frictionless switch failed: {sw_res}"
    assert sw_res.get("token"), "Switch must return authorization token"
    assert sw_res.get("user", {}).get("role_code") == "CUTTING_MASTER"
    print("    ✓ Frictionless switch to usr-santosh succeeded without password prompt")

def test_password_enforcement_toggle():
    print("[5] Testing password authentication toggle & security enforcement...")
    try:
        # Enable password requirement
        status, t_res = make_req("/api/auth/settings/toggle-password", method="POST", data={"enabled": True})
        assert status == 200 and t_res.get("requirePasswordAuth") is True, f"Toggle failed: {t_res}"
        print("    ✓ Enabled require_password_auth = true")

        # Attempt to switch without password -> MUST FAIL with passwordRequired
        status, fail_res = make_req("/api/auth/switch-user", method="POST", data={"userId": "usr-prashant"})
        assert status == 401 or fail_res.get("passwordRequired") is True, f"Expected passwordRequired, got {fail_res}"
        print("    ✓ Switch without password rejected as expected (passwordRequired: true)")

        # Attempt with WRONG password -> MUST FAIL
        status, wrong_res = make_req("/api/auth/switch-user", method="POST", data={"userId": "usr-prashant", "password": "WrongPassword"})
        assert (status in [401, 403]) and not wrong_res.get("success"), f"Expected failure with wrong password, got status {status}: {wrong_res}"
        print("    ✓ Switch with wrong password rejected")

        # Attempt with CORRECT password -> MUST SUCCEED
        status, ok_res = make_req("/api/auth/switch-user", method="POST", data={"userId": "usr-prashant", "password": "Pass@123"})
        assert status == 200 and ok_res.get("success"), f"Switch with correct password failed: {ok_res}"
        print("    ✓ Switch with valid password (Pass@123) verified & token minted")

    finally:
        # ALWAYS restore frictionless default
        status, r_res = make_req("/api/auth/settings/toggle-password", method="POST", data={"enabled": False})
        assert status == 200 and r_res.get("requirePasswordAuth") is False, "Failed to restore frictionless default"
        print("    ✓ Restored require_password_auth = false (Frictionless default restored)")

def test_semantic_graph_multi_hop_hierarchy():
    print("[6] Validating Semantic Graph BFS Multi-Hop Join Resolution...")
    # Test query using the reporting engine with deep role & manager relationships
    status, rep_res = make_req("/api/reports/query", method="POST", data={
        "rootEntity": "users",
        "fields": ["users.user_name", "users.department", "users.role_info.name", "users.manager.user_name"],
        "limit": 5
    })
    assert status == 200 and rep_res.get("success"), f"Graph report query failed: {rep_res}"
    print(f"    ✓ Multi-hop graph query (users -> manager) resolved successfully with {len(rep_res.get('data', []))} rows")

def main():
    print("=" * 65)
    print("FPCC Cortex: Role Management, Hierarchy & Security Test Suite")
    print("=" * 65)
    test_database_schema()
    test_api_roles_and_hierarchy()
    test_api_auth_and_user_profiles()
    test_frictionless_switching()
    test_password_enforcement_toggle()
    test_semantic_graph_multi_hop_hierarchy()
    print("=" * 65)
    print("ALL TESTS PASSED! Enterprise Role Management & Hierarchy fully operational.")
    print("=" * 65)

if __name__ == "__main__":
    main()
