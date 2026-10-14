-- FPCC Cortex: Enterprise Production Backend Extensions
-- Adds: Product BOM Templates, Order BOM Allocations, Purchase Orders & Procurement,
-- Remake Work Orders, Subcontractor Debit Notes, Order Completion Reports (OCR), and System Audit Trail.

-- 1. PRODUCT BOM TEMPLATES (Recipe specifications per garment)
CREATE TABLE IF NOT EXISTS product_bom_templates (
    id TEXT PRIMARY KEY,
    product_category TEXT NOT NULL, -- 'Apparel', 'Merchandise', 'Uniforms'
    sub_category TEXT NOT NULL, -- 'Polo', 'Round_Neck', 'Hoodie', 'Jacket', 'Joggers'
    product_name TEXT NOT NULL UNIQUE,
    default_fabric_name TEXT NOT NULL REFERENCES fabric_catalog(fpcc_fab_name),
    default_fabric_consumption_kg REAL NOT NULL DEFAULT 0.220, -- kg per pc
    has_collar_cuff INTEGER NOT NULL DEFAULT 1, -- 1 for Polo, 0 for Round Neck
    collar_pieces_per_pc INTEGER DEFAULT 1,
    cuff_pieces_per_pc INTEGER DEFAULT 2,
    button_pieces_per_pc INTEGER DEFAULT 3,
    thread_cones_per_100_pcs REAL DEFAULT 0.8,
    label_pieces_per_pc INTEGER DEFAULT 2, -- Brand label + wash care label
    polybag_per_pc INTEGER DEFAULT 1,
    standard_cutting_rate REAL DEFAULT 8.0,
    standard_stitching_rate REAL DEFAULT 35.0,
    standard_finishing_rate REAL DEFAULT 12.0,
    standard_branding_rate REAL DEFAULT 25.0,
    rejection_buffer_pct REAL DEFAULT 5.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. ORDER BOM ALLOCATIONS & SHORTFALL TRACKER
CREATE TABLE IF NOT EXISTS order_bom_allocations (
    id TEXT PRIMARY KEY,
    production_order_no TEXT NOT NULL REFERENCES production_orders(production_order_no),
    item_type TEXT NOT NULL, -- 'Fabric', 'Collar', 'Cuff', 'Button', 'Thread', 'Label', 'Polybag', 'Packing_Box'
    item_name TEXT NOT NULL,
    color_name TEXT,
    uom TEXT NOT NULL DEFAULT 'pcs', -- 'kg', 'pcs', 'cones', 'boxes'
    required_qty REAL NOT NULL,
    allocated_qty REAL DEFAULT 0.0,
    shortfall_qty REAL DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Allocated', 'PO_Drafted', 'PO_Dispatched', 'Fulfilled')),
    purchase_order_no TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. PURCHASE ORDERS & PROCUREMENT (To Fabric Mills & Trims Vendors)
CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    purchase_order_no TEXT NOT NULL UNIQUE, -- e.g. PO-261014-01
    vendor_id TEXT NOT NULL REFERENCES entities(id),
    vendor_name TEXT NOT NULL,
    vendor_contact_person TEXT,
    vendor_phone TEXT,
    vendor_email TEXT,
    order_type TEXT NOT NULL DEFAULT 'Fabric', -- 'Fabric', 'Accessories', 'Job_Work', 'Packaging'
    related_production_order_no TEXT REFERENCES production_orders(production_order_no),
    po_date DATE DEFAULT (DATE('now')),
    expected_delivery_date DATE,
    subtotal_amount REAL NOT NULL DEFAULT 0.0,
    tax_amount REAL NOT NULL DEFAULT 0.0,
    total_amount REAL NOT NULL DEFAULT 0.0,
    payment_terms TEXT DEFAULT '30_days_credit',
    delivery_terms TEXT DEFAULT 'door_delivery',
    status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Sent_To_Vendor', 'Acknowledged', 'Partially_Received', 'Completed', 'Cancelled')),
    whatsapp_dispatch_status TEXT DEFAULT 'NOT_SENT',
    notes TEXT,
    created_by TEXT REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. PURCHASE ORDER LINE ITEMS
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id TEXT PRIMARY KEY,
    purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL, -- 'Fabric', 'Collar_Cuff', 'Button', 'Label', 'Packaging'
    item_name TEXT NOT NULL,
    color_name TEXT,
    specifications TEXT, -- GSM, Width, Size, Quality
    ordered_qty REAL NOT NULL,
    uom TEXT NOT NULL DEFAULT 'kg',
    unit_price REAL NOT NULL,
    line_total REAL NOT NULL,
    received_qty REAL DEFAULT 0.0,
    balance_qty REAL NOT NULL,
    status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Partially_Received', 'Received'))
);

-- 5. REMAKE WORK ORDERS (Automated Priority Remediation)
CREATE TABLE IF NOT EXISTS remake_work_orders (
    id TEXT PRIMARY KEY,
    remake_order_no TEXT NOT NULL UNIQUE, -- e.g. RMK-261014-01
    production_order_no TEXT NOT NULL REFERENCES production_orders(production_order_no),
    source_incident TEXT NOT NULL, -- 'Subcontractor_Rejection', 'QC_Inspection_Fail', 'Transit_Loss', 'Cutting_Defect'
    incident_ref_no TEXT, -- Challan No, Transit Pass No, QC Log ID
    parent_dye_lot_id TEXT NOT NULL, -- Mandatory matching parent dye lot to prevent shade variance
    fabric_name TEXT NOT NULL,
    color_name TEXT NOT NULL,
    size_breakdown_json TEXT NOT NULL, -- {"S": 5, "M": 10}
    total_pcs_to_remake INTEGER NOT NULL,
    estimated_fabric_kg REAL NOT NULL,
    priority TEXT NOT NULL DEFAULT 'CRITICAL' CHECK (priority IN ('NORMAL', 'HIGH', 'CRITICAL')),
    status TEXT NOT NULL DEFAULT 'Queued' CHECK (status IN ('Queued', 'Fabric_Issued', 'Cut_Complete', 'Branded', 'Stitched', 'Closed')),
    assigned_cutter_id TEXT REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. SUBCONTRACTOR DEBIT NOTES (For Damaged / Spoiled Panels)
CREATE TABLE IF NOT EXISTS debit_notes (
    id TEXT PRIMARY KEY,
    debit_note_no TEXT NOT NULL UNIQUE, -- e.g. DN-261014-01
    vendor_id TEXT NOT NULL REFERENCES entities(id),
    vendor_name TEXT NOT NULL,
    challan_no TEXT NOT NULL REFERENCES subcontractor_challans(challan_no),
    production_order_no TEXT NOT NULL REFERENCES production_orders(production_order_no),
    rejected_qty INTEGER NOT NULL,
    panel_cost_per_pc REAL NOT NULL, -- Fabric cost + cutting cost invested
    penalty_rate_per_pc REAL DEFAULT 0.0,
    total_debit_amount REAL NOT NULL,
    reason TEXT NOT NULL, -- 'Print Smudge', 'Needle Cut', 'Burn Mark'
    defect_photo_url TEXT,
    status TEXT NOT NULL DEFAULT 'Issued' CHECK (status IN ('Issued', 'Accepted_By_Vendor', 'Settled_In_Billing', 'Disputed')),
    created_by TEXT REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. ORDER COMPLETION REPORTS (OCR Post-Mortem Intelligence)
CREATE TABLE IF NOT EXISTS order_completion_reports (
    id TEXT PRIMARY KEY,
    ocr_no TEXT NOT NULL UNIQUE, -- e.g. OCR-261014-01
    production_order_no TEXT NOT NULL UNIQUE REFERENCES production_orders(production_order_no),
    client_name TEXT NOT NULL,
    product_name TEXT NOT NULL,
    color_name TEXT NOT NULL,
    total_planned_pcs INTEGER NOT NULL,
    total_cut_pcs INTEGER NOT NULL,
    total_packed_pcs INTEGER NOT NULL,
    surplus_overrun_pcs INTEGER DEFAULT 0,
    shortage_pcs INTEGER DEFAULT 0,
    -- Fabric Material Reconciliation
    planned_fabric_kg REAL NOT NULL,
    actual_fabric_issued_kg REAL NOT NULL,
    fabric_remnant_returned_kg REAL NOT NULL,
    net_fabric_consumed_kg REAL NOT NULL,
    fabric_scrap_kg REAL NOT NULL,
    planned_fabric_avg_kg_per_pc REAL NOT NULL,
    actual_fabric_avg_kg_per_pc REAL NOT NULL,
    fabric_efficiency_pct REAL NOT NULL,
    -- Financial Realization
    total_invoice_value_inr REAL NOT NULL,
    total_material_cost_inr REAL NOT NULL,
    total_labour_operations_cost_inr REAL NOT NULL,
    total_rework_cost_inr REAL DEFAULT 0.0,
    total_vendor_debit_recovery_inr REAL DEFAULT 0.0,
    net_actual_production_cost_inr REAL NOT NULL,
    gross_realized_profit_inr REAL NOT NULL,
    realized_profit_pct REAL NOT NULL,
    quoted_profit_pct REAL NOT NULL,
    margin_variance_pct REAL NOT NULL, -- realized - quoted
    closure_status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (closure_status IN ('COMPLETED', 'SURPLUS_STOCKED', 'INVESTIGATION_REQUIRED')),
    closed_by TEXT REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. SYSTEM AUDIT TRAIL (Compliance & Telemetry Event Log)
CREATE TABLE IF NOT EXISTS audit_trail (
    id TEXT PRIMARY KEY,
    event_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_id TEXT,
    user_name TEXT,
    event_category TEXT NOT NULL, -- 'INVENTORY', 'CUTTING', 'RUNNER', 'CHALLAN', 'ORDER', 'FINANCE', 'WHATSAPP'
    action TEXT NOT NULL, -- 'CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'DISCREPANCY_FLAG', 'REMAKE_TRIGGER'
    entity_table TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    old_state_json TEXT,
    new_state_json TEXT,
    ip_address TEXT,
    remarks TEXT
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_bom_template_cat ON product_bom_templates(product_category, sub_category);
CREATE INDEX IF NOT EXISTS idx_order_bom_order ON order_bom_allocations(production_order_no);
CREATE INDEX IF NOT EXISTS idx_po_vendor ON purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_order ON purchase_orders(related_production_order_no);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_remake_order ON remake_work_orders(production_order_no);
CREATE INDEX IF NOT EXISTS idx_remake_lot ON remake_work_orders(parent_dye_lot_id);
CREATE INDEX IF NOT EXISTS idx_debit_vendor ON debit_notes(vendor_id);
CREATE INDEX IF NOT EXISTS idx_debit_challan ON debit_notes(challan_no);
CREATE INDEX IF NOT EXISTS idx_ocr_order ON order_completion_reports(production_order_no);
CREATE INDEX IF NOT EXISTS idx_audit_category ON audit_trail(event_category);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_trail(event_time);
