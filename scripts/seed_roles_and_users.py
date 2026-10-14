#!/usr/bin/env python3
"""
FPCC Cortex: Seed Roles, Archetypes, and Organizational Hierarchy
Integrates roles and hierarchy-informed relationships into SQLite and the Semantic Graph.
"""

import sqlite3
import json
import hashlib
import os

DB_PATH = os.path.join(os.path.dirname(__file__), '../data/fpcc_cortex.db')

def get_hash(secret, salt='fpcc2026salt'):
    # PBKDF2 hash compatible with Node crypto
    h = hashlib.pbkdf2_hmac('sha256', secret.encode('utf-8'), salt.encode('utf-8'), 10000, 32).hex()
    return f"{salt}:{h}"

def seed():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    print("[*] Creating roles and system_settings tables...")
    cur.execute("""
    CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        level INTEGER NOT NULL,
        parent_role_code TEXT,
        department TEXT NOT NULL,
        description TEXT,
        allowed_views TEXT NOT NULL,
        allowed_reports TEXT NOT NULL,
        allowed_workflows TEXT NOT NULL,
        permissions TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_role_code) REFERENCES roles(code)
    )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_roles_level ON roles(level)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_roles_parent ON roles(parent_role_code)")

    cur.execute("""
    CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Seed initial setting: require_password_auth = false (disabled for frictionless switching)
    cur.execute("""
    INSERT OR REPLACE INTO system_settings (key, value)
    VALUES ('require_password_auth', 'false')
    """)

    # Update users table with new columns if missing
    columns = [r[1] for r in cur.execute("PRAGMA table_info(users)").fetchall()]
    new_cols = [
        ('role_code', 'TEXT REFERENCES roles(code)'),
        ('manager_id', 'TEXT REFERENCES users(id)'),
        ('password_hash', 'TEXT'),
        ('salt', 'TEXT'),
        ('phone', 'TEXT'),
        ('department', 'TEXT'),
        ('designation', 'TEXT'),
        ('avatar_color', 'TEXT')
    ]
    for col_name, col_type in new_cols:
        if col_name not in columns:
            print(f"[*] Adding column {col_name} to users table...")
            cur.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}")

    # Define 11 Organizational Archetype Roles
    roles = [
        (
            'role_super_admin',
            'SUPER_ADMIN',
            'Super Admin (God Mode)',
            1,
            None,
            'Executive Management',
            'Unrestricted enterprise oversight with god-mode visibility across all factory operations, CRM, finance, stock ledgers, graph reports, and workflows.',
            json.dumps(['*']),
            json.dumps(['*']),
            json.dumps(['*']),
            json.dumps([
                'god_mode', 'manage_roles', 'manage_users', 'manage_workflows',
                'approve_po', 'edit_master', 'view_costing', 'record_payment', 'audit_access'
            ])
        ),
        (
            'role_operations_head',
            'OPERATIONS_HEAD',
            'Plant Operations Head',
            2,
            'SUPER_ADMIN',
            'Plant Leadership',
            'Oversees all manufacturing stages: cutting, subcontracting, sewing floor, QC, packing, and runner logistics. Eliminates floor bottlenecks.',
            json.dumps(['radar', 'runner', 'cutting', 'challan', 'floor', 'packing', 'inward', 'issue', 'ledger', 'reports', 'workflows']),
            json.dumps(['*']),
            json.dumps(['*']),
            json.dumps([
                'manage_floor', 'approve_remake', 'view_stock', 'issue_fabric',
                'manage_workflows', 'view_all_reports', 'escalate_discrepancy'
            ])
        ),
        (
            'role_merchandiser',
            'MERCHANDISER',
            'Senior Merchandiser',
            2,
            'SUPER_ADMIN',
            'Merchandising & Commercial',
            'Commercial intake, sales order matrix, BOM explosion, material shortfall PO approvals, customer delivery schedules, and margin post-mortems.',
            json.dumps(['crm', 'finance', 'radar', 'reports', 'whatsapp']),
            json.dumps(['order_360_post_mortem', 'client_receivables_and_cashflow', 'cutting_yield_palla_variance']),
            json.dumps(['orders', 'invoices', 'payments']),
            json.dumps([
                'create_order', 'run_costing', 'approve_po', 'generate_invoice',
                'view_crm', 'dispatch_whatsapp_ack'
            ])
        ),
        (
            'role_accounts_executive',
            'ACCOUNTS_EXECUTIVE',
            'Finance & Accounts Officer',
            3,
            'MERCHANDISER',
            'Finance & Accounting',
            'Statutory Indian GST tax invoicing, payment receipt reconciliation with bank UTRs, vendor debit notes, and client receivables aging.',
            json.dumps(['finance', 'crm', 'reports']),
            json.dumps(['client_receivables_and_cashflow', 'order_360_post_mortem', 'subcontractor_quality_and_debit_recovery']),
            json.dumps(['invoices', 'payments', 'debit_notes']),
            json.dumps([
                'create_invoice', 'record_payment', 'issue_debit_note', 'view_financial_audit'
            ])
        ),
        (
            'role_stores_manager',
            'STORES_MANAGER',
            'Stores & Fabric Warehouse Manager',
            3,
            'OPERATIONS_HEAD',
            'Raw Material Inventory',
            'Multi-component dye lot parent codes, fabric roll check-in, weight scale telemetry, dual UOM conversion, immutable double-entry stock ledger, and material issue.',
            json.dumps(['inward', 'issue', 'ledger', 'reports']),
            json.dumps(['dye_lot_lineage_traceability', 'cutting_yield_palla_variance']),
            json.dumps(['parent_lots', 'bundles']),
            json.dumps([
                'inward_fabric', 'print_roll_stickers', 'issue_rolls', 'receive_remnants', 'view_stock_ledger'
            ])
        ),
        (
            'role_cutting_master',
            'CUTTING_MASTER',
            'Cutting Master & Yield Specialist',
            4,
            'OPERATIONS_HEAD',
            'Cutting Floor',
            'Cutting lay planning, sample Master Palla average weighing, actual consumption vs BOM variance calculation, remnant roll returns, and remake cut-slips.',
            json.dumps(['cutting', 'issue', 'reports']),
            json.dumps(['cutting_yield_palla_variance', 'dye_lot_lineage_traceability']),
            json.dumps(['cutting_jobs', 'remakes']),
            json.dumps([
                'record_cutting_lay', 'input_palla_telemetry', 'return_remnant_roll', 'request_remake'
            ])
        ),
        (
            'role_sub_challan_supervisor',
            'SUB_CHALLAN_SUPERVISOR',
            'Subcontractor & Job-Work Coordinator',
            4,
            'OPERATIONS_HEAD',
            'Embellishments & Job-Work',
            'Issues GST delivery challans to external job-workers (embroidery, printing), counts returned panels, logs defect categories & photo evidence, triggers auto-debit notes.',
            json.dumps(['challan', 'reports']),
            json.dumps(['subcontractor_quality_and_debit_recovery']),
            json.dumps(['challans', 'debit_notes', 'remakes']),
            json.dumps([
                'create_challan', 'receive_challan_panels', 'log_defect_photos', 'trigger_debit_note'
            ])
        ),
        (
            'role_stitching_supervisor',
            'STITCHING_SUPERVISOR',
            'Stitching Line Supervisor',
            4,
            'OPERATIONS_HEAD',
            'Sewing & Assembly',
            'Line balancing, machine operator output telemetry (Kaaj, Button, Overlock), bundle tracking, and floor WIP velocity.',
            json.dumps(['floor', 'reports']),
            json.dumps(['floor_qc_defect_pareto']),
            json.dumps(['floor_logs']),
            json.dumps([
                'log_stitching_telemetry', 'track_sewing_wip', 'log_hourly_output'
            ])
        ),
        (
            'role_qc_inspector',
            'QC_INSPECTOR',
            '100% Quality & Finishing Inspector',
            4,
            'OPERATIONS_HEAD',
            'Quality Control',
            'Conducts 100% garment inspection, Defect Pareto logging, defect taxonomy classification, garment alteration routing, and final pass approval.',
            json.dumps(['floor', 'reports']),
            json.dumps(['floor_qc_defect_pareto']),
            json.dumps(['floor_logs']),
            json.dumps([
                'record_qc_inspection', 'log_defect_pareto', 'route_alteration', 'approve_final_pass'
            ])
        ),
        (
            'role_packing_supervisor',
            'PACKING_SUPERVISOR',
            'Carton Packing & Dispatch Supervisor',
            4,
            'OPERATIONS_HEAD',
            'Packing & Shipping',
            'Master carton packing, gross weight scale telemetry, strict over-pack prevention, shipping label generation, and dispatch manifests.',
            json.dumps(['packing', 'reports']),
            json.dumps(['carton_fulfillment_manifest']),
            json.dumps(['cartons']),
            json.dumps([
                'seal_carton', 'generate_shipping_label', 'validate_order_completion', 'dispatch_manifest'
            ])
        ),
        (
            'role_runner',
            'RUNNER',
            'Internal Logistics Runner',
            5,
            'OPERATIONS_HEAD',
            'Internal Logistics',
            'Inter-station material transit passes, physical chain-of-custody pickup, and destination verification with strict discrepancy & loss reporting.',
            json.dumps(['runner']),
            json.dumps(['runner_custody_loss_hotspots']),
            json.dumps(['transits']),
            json.dumps([
                'accept_transit_pickup', 'verify_transit_handover', 'flag_custody_discrepancy'
            ])
        )
    ]

    print("[*] Seeding 11 Organizational Archetype Roles...")
    for r in roles:
        cur.execute("""
        INSERT OR REPLACE INTO roles (
            id, code, name, level, parent_role_code, department,
            description, allowed_views, allowed_reports, allowed_workflows, permissions
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, r)

    default_hash = get_hash('Pass@123')

    # Archetype Users with Defined Hierarchy Relationships
    users_to_seed = [
        # (id, name, email, role_code, manager_id, pin, dept, designation, avatar_color)
        ('usr-rimpy', 'Rimpy', 'rimpy@firstpromotional.com', 'SUPER_ADMIN', None, '1111', 'Executive Management', 'Founder & Managing Director', '#8b5cf6'),
        ('usr-prashant', 'Prashant', 'logistic@firstpromotional.com', 'OPERATIONS_HEAD', 'usr-rimpy', '2222', 'Plant Leadership', 'Operations Head & Plant Manager', '#3b82f6'),
        ('usr-meenakshi', 'Meenakshi', 'merchandiser@firstpromotional.com', 'MERCHANDISER', 'usr-rimpy', '5555', 'Merchandising & Sales', 'Senior Merchandiser & Commercial Head', '#ec4899'),
        ('usr-kavita', 'Kavita', 'accounts@firstpromotional.com', 'ACCOUNTS_EXECUTIVE', 'usr-meenakshi', '7701', 'Finance & Accounts', 'Finance & Accounts Officer', '#10b981'),
        ('usr-aniket', 'Aniket', 'stores@firstpromotional.com', 'STORES_MANAGER', 'usr-prashant', '3333', 'Raw Material Inventory', 'Stores & Fabric Warehouse Manager', '#14b8a6'),
        ('usr-santosh', 'Santosh (Cutting Master)', 'santosh@fpcc.in', 'CUTTING_MASTER', 'usr-prashant', '9901', 'Cutting Floor', 'Master Cutter & Lay Specialist', '#f59e0b'),
        ('usr-vikas', 'Vikas (Subcontractor)', 'vikas@fpcc.in', 'SUB_CHALLAN_SUPERVISOR', 'usr-prashant', '9906', 'Embellishments & Job-Work', 'Subcontractor & Challan Coordinator', '#d946ef'),
        ('usr-suresh', 'Suresh (Stitching Supervisor)', 'suresh@fpcc.in', 'STITCHING_SUPERVISOR', 'usr-prashant', '9904', 'Sewing & Assembly', 'Stitching Line Supervisor', '#06b6d4'),
        ('usr-dilip', 'Dilip (Finishing & QC)', 'dilip@fpcc.in', 'QC_INSPECTOR', 'usr-prashant', '9905', 'Quality Control', '100% Quality & Finishing Inspector', '#84cc16'),
        ('usr-rohit', 'Rohit (Packing Store)', 'rohit@firstpromotional.com', 'PACKING_SUPERVISOR', 'usr-prashant', '6666', 'Packing & Shipping', 'Carton Packing & Dispatch Supervisor', '#6366f1'),
        ('usr-mukesh', 'Mukesh (Runner)', 'mukesh@fpcc.in', 'RUNNER', 'usr-prashant', '9903', 'Internal Logistics', 'Internal Logistics Runner 1', '#0ea5e9'),
        ('usr-ramesh', 'Ramesh (Runner)', 'ramesh@fpcc.in', 'RUNNER', 'usr-prashant', '9902', 'Internal Logistics', 'Internal Logistics Runner 2', '#38bdf8'),
    ]

    print("[*] Seeding 12 Archetype Users with hierarchy relationships...")
    for u in users_to_seed:
        uid, uname, email, rcode, mgr_id, pin, dept, desig, color = u
        cur.execute("""
        INSERT OR REPLACE INTO users (
            id, user_name, email, role, role_code, manager_id,
            pin_code, password_hash, salt, department, designation, avatar_color, active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        """, (
            uid, uname, email, rcode, rcode, mgr_id,
            pin, default_hash, 'fpcc2026salt', dept, desig, color
        ))

    conn.commit()
    conn.close()
    print("[✓] Roles and Archetype Users seeded successfully!")

if __name__ == '__main__':
    seed()
