-- FPCC Cortex: Canonical SQLite Schema for Apparel Manufacturing Operations & Inventory
-- Supports: Multi-Component Dye Lots, Fractional Roll Sequences, Perpetual Double-Entry Stock Ledger

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- 1. USERS & ROLES
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    user_name TEXT NOT NULL,
    email TEXT UNIQUE,
    role TEXT NOT NULL, -- SuperAdmin, Admin, Stores, Merchandiser, Packing Store
    pin_code TEXT DEFAULT '1234',
    can_inward INTEGER DEFAULT 1,
    can_issue INTEGER DEFAULT 1,
    can_return INTEGER DEFAULT 1,
    edit_master INTEGER DEFAULT 0,
    can_block INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. BUSINESS ENTITIES (Vendors & Clients)
CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('vendor', 'client', 'both')),
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    gstin TEXT,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. RAW MATERIAL CATALOG & COLORS
CREATE TABLE IF NOT EXISTS fabric_catalog (
    id TEXT PRIMARY KEY,
    fpcc_fab_name TEXT NOT NULL UNIQUE,
    generic_name TEXT,
    default_gsm REAL,
    default_width REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS colors (
    id TEXT PRIMARY KEY,
    color_name TEXT NOT NULL UNIQUE,
    hex_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. PARENT INWARD LOTS (The Multi-Component Dye Lot Entity)
CREATE TABLE IF NOT EXISTS parent_inward_lots (
    id TEXT PRIMARY KEY,
    parent_code TEXT NOT NULL UNIQUE, -- Format: DDMMYY-A (e.g. 160326-A)
    inward_date TEXT NOT NULL,
    vendor_id TEXT NOT NULL REFERENCES entities(id),
    invoice_no TEXT NOT NULL,
    inward_type TEXT NOT NULL CHECK (inward_type IN ('Fabric', 'Collar', 'Cuff', 'Rib', 'Zip', 'Label', 'Trims', 'Packaging')),
    vendor_fab_name TEXT,
    vendor_color TEXT,
    no_of_bundles INTEGER DEFAULT 1,
    uom TEXT NOT NULL DEFAULT 'kg', -- kg, pcs, mtrs, roll, sets
    invoice_qty REAL NOT NULL, -- 3 decimals
    inward_physical_qty REAL DEFAULT 0.0,
    shortfall_qty REAL DEFAULT 0.0,
    rate REAL,
    remarks TEXT,
    created_by TEXT REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. FABRIC BUNDLES (Child Rolls with Fractional Sequence & Dual Weight Telemetry)
CREATE TABLE IF NOT EXISTS fabric_bundles (
    id TEXT PRIMARY KEY,
    bundle_code TEXT NOT NULL UNIQUE, -- e.g. 160326-A-01/06
    parent_lot_id TEXT NOT NULL REFERENCES parent_inward_lots(id) ON DELETE CASCADE,
    parent_code TEXT NOT NULL,
    bundle_sequence INTEGER NOT NULL,
    total_bundles INTEGER NOT NULL,
    fabric_name TEXT NOT NULL,
    color_name TEXT NOT NULL,
    material_sub_type TEXT DEFAULT 'Fabric', -- Fabric, Collar, Cuff, Rib
    bundle_gsm REAL,
    bundle_width REAL,
    original_qty REAL NOT NULL, -- Initial inward weight in kg (3 decimals) or pcs
    available_qty REAL NOT NULL, -- Remaining weight in kg
    issued_qty REAL DEFAULT 0.0,
    location_bin TEXT NOT NULL, -- Rack / Bin ID (e.g. R1-B04)
    qc_status TEXT DEFAULT 'PENDING' CHECK (qc_status IN ('PENDING', 'PASSED', 'REJECTED')),
    qc_done_by TEXT REFERENCES users(id),
    qc_comment TEXT,
    qr_payload TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. ACCESSORIES & TRIMS (Zips, Labels, Packaging, Trims)
CREATE TABLE IF NOT EXISTS accessory_items (
    id TEXT PRIMARY KEY,
    item_code TEXT NOT NULL UNIQUE, -- e.g. 160326-C-ZIP-01
    parent_lot_id TEXT NOT NULL REFERENCES parent_inward_lots(id) ON DELETE CASCADE,
    parent_code TEXT NOT NULL,
    material_type TEXT NOT NULL CHECK (material_type IN ('Zip', 'Label', 'Trims', 'Packaging')),
    item_name TEXT NOT NULL,
    full_description TEXT NOT NULL,
    color_name TEXT,
    size_spec TEXT,
    uom TEXT NOT NULL, -- pcs, mtrs, roll, sets
    original_qty REAL NOT NULL,
    available_qty REAL NOT NULL,
    issued_qty REAL DEFAULT 0.0,
    location_bin TEXT,
    meta_json TEXT, -- JSON attributes: zip slider, teeth_no, closure; label genre; etc.
    qr_payload TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. PRODUCTION ORDERS & WORK ORDERS
CREATE TABLE IF NOT EXISTS production_orders (
    id TEXT PRIMARY KEY,
    production_order_no TEXT NOT NULL UNIQUE, -- e.g. FPCC-PO-26001
    sales_order_no TEXT,
    order_type TEXT DEFAULT 'Bulk' CHECK (order_type IN ('Bulk', 'Sample', 'FOC', 'Development')),
    client_id TEXT REFERENCES entities(id),
    client_name TEXT NOT NULL,
    product_name TEXT NOT NULL,
    color_name TEXT NOT NULL,
    total_qty INTEGER NOT NULL,
    target_etd TEXT,
    status TEXT DEFAULT 'In_Progress' CHECK (status IN ('Planning', 'Material_Allocated', 'Cutting', 'Branding', 'Stitching', 'Finishing', 'Packed', 'Dispatched', 'Completed')),
    remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. ORDER SIZE MATRIX
CREATE TABLE IF NOT EXISTS order_size_matrix (
    id TEXT PRIMARY KEY,
    production_order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
    size_label TEXT NOT NULL, -- XS, S, M, L, XL, 2XL, 3XL
    order_qty INTEGER NOT NULL,
    cut_qty INTEGER DEFAULT 0,
    finished_qty INTEGER DEFAULT 0,
    packed_qty INTEGER DEFAULT 0
);

-- 9. PERPETUAL DOUBLE-ENTRY STOCK LEDGER
-- Every physical move creates a strict ledger record
CREATE TABLE IF NOT EXISTS inventory_stock_ledger (
    id TEXT PRIMARY KEY,
    txn_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    txn_type TEXT NOT NULL CHECK (txn_type IN ('INWARD', 'ISSUE_PRODUCTION', 'RETURN_PRODUCTION', 'SCRAP_ADJUSTMENT', 'TRANSFER', 'FG_INWARD', 'FG_DISPATCH')),
    parent_code TEXT NOT NULL,
    bundle_code TEXT,
    accessory_code TEXT,
    production_order_no TEXT,
    material_type TEXT NOT NULL, -- Fabric, Collar, Cuff, Rib, Zip, Label, Trims, Packaging
    item_name TEXT NOT NULL,
    color_name TEXT NOT NULL,
    uom TEXT NOT NULL DEFAULT 'kg',
    qty_in REAL DEFAULT 0.0,
    qty_out REAL DEFAULT 0.0,
    balance_after REAL NOT NULL,
    location_bin TEXT,
    performed_by TEXT REFERENCES users(id),
    remarks TEXT
);

-- Indexes for ultra-fast query latency
CREATE INDEX IF NOT EXISTS idx_parent_code ON parent_inward_lots(parent_code);
CREATE INDEX IF NOT EXISTS idx_bundle_code ON fabric_bundles(bundle_code);
CREATE INDEX IF NOT EXISTS idx_bundle_parent ON fabric_bundles(parent_code);
CREATE INDEX IF NOT EXISTS idx_ledger_parent ON inventory_stock_ledger(parent_code);
CREATE INDEX IF NOT EXISTS idx_ledger_order ON inventory_stock_ledger(production_order_no);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON inventory_stock_ledger(txn_date);
-- FPCC Cortex: Operations & Telemetry Schema Extensions
-- Supports: Cutting lay & palla avg, Runner logistics, Subcontractor challans, Finishing/QC, and Carton packing

-- 1. CUTTING JOBS & LAY TELEMETRY
CREATE TABLE IF NOT EXISTS cutting_jobs (
    id TEXT PRIMARY KEY,
    cut_job_no TEXT NOT NULL UNIQUE, -- e.g. CUT-26001-01
    production_order_no TEXT NOT NULL REFERENCES production_orders(production_order_no),
    bundle_code TEXT NOT NULL REFERENCES fabric_bundles(bundle_code),
    cutter_id TEXT NOT NULL REFERENCES users(id),
    lay_no INTEGER DEFAULT 1,
    lay_length_meters REAL,
    plies_count INTEGER,
    sample_palla_pcs INTEGER NOT NULL, -- e.g. 6 pcs sample cut
    sample_palla_weight_kg REAL NOT NULL, -- e.g. 1.200 kg
    calculated_palla_avg_kg REAL NOT NULL, -- sample_palla_weight_kg / sample_palla_pcs (e.g. 0.200 kg/pc)
    total_fabric_weight_used_kg REAL NOT NULL,
    total_pcs_cut INTEGER NOT NULL,
    size_breakdown_json TEXT NOT NULL, -- {"S": 30, "M": 60, "L": 60, "XL": 30}
    actual_consumption_per_pc REAL NOT NULL, -- total_fabric_weight_used_kg / total_pcs_cut
    target_bom_consumption REAL, -- standard planned BOM consumption
    variance_pct REAL, -- ((actual - bom) / bom) * 100
    remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. MATERIAL TRANSITS & RUNNER LOGISTICS (CHAIN OF CUSTODY)
CREATE TABLE IF NOT EXISTS material_transits (
    id TEXT PRIMARY KEY,
    transit_pass_no TEXT NOT NULL UNIQUE, -- e.g. TRN-26001-01
    production_order_no TEXT NOT NULL REFERENCES production_orders(production_order_no),
    source_station TEXT NOT NULL, -- 'Warehouse', 'Cutting', 'Branding', 'Stitching', 'Finishing', 'QC', 'Packing', 'Dispatch'
    dest_station TEXT NOT NULL,
    runner_id TEXT NOT NULL REFERENCES users(id),
    item_type TEXT NOT NULL, -- 'Fabric_Rolls', 'Cut_Panels', 'Semi_Stitched', 'Finished_Garments', 'Sealed_Cartons', 'Trims_Accessories'
    item_ref TEXT, -- Bundle code, Cut job no, Challan no, Carton no
    dispatched_qty INTEGER NOT NULL,
    dispatched_by TEXT NOT NULL REFERENCES users(id),
    dispatched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    picked_up_at DATETIME,
    received_qty INTEGER,
    received_by TEXT REFERENCES users(id),
    received_at DATETIME,
    transit_status TEXT NOT NULL DEFAULT 'DISPATCHED' CHECK (transit_status IN ('DISPATCHED', 'IN_TRANSIT', 'DELIVERED_VERIFIED', 'DISCREPANCY_FLAGGED')),
    variance_qty INTEGER DEFAULT 0, -- dispatched_qty - received_qty (Discrepancy)
    discrepancy_reason TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. SUBCONTRACTOR CHALLANS (BRANDING & JOB-WORK)
CREATE TABLE IF NOT EXISTS subcontractor_challans (
    id TEXT PRIMARY KEY,
    challan_no TEXT NOT NULL UNIQUE, -- e.g. CH-26001-01
    production_order_no TEXT NOT NULL REFERENCES production_orders(production_order_no),
    vendor_id TEXT NOT NULL REFERENCES entities(id),
    process_type TEXT NOT NULL DEFAULT 'Branding', -- 'Branding', 'Stitching', 'Washing'
    branding_type TEXT, -- 'Screen_Print', 'Embroidery', 'DTF', 'Heatseal'
    panel_name TEXT NOT NULL, -- 'Front_Chest', 'Back_Print', 'Left_Sleeve', 'Collar_Embroidery', 'Full_Garment'
    qty_sent INTEGER NOT NULL,
    date_sent DATETIME DEFAULT CURRENT_TIMESTAMP,
    expected_eta DATE,
    qty_received INTEGER DEFAULT 0,
    actual_received_date DATETIME,
    rejection_qty INTEGER DEFAULT 0,
    rejection_reason TEXT,
    rework_qty INTEGER DEFAULT 0,
    defect_photo_url TEXT,
    status TEXT NOT NULL DEFAULT 'Dispatched' CHECK (status IN ('Dispatched', 'At_Vendor', 'Partially_Received', 'Completed', 'Rework_Pending')),
    created_by TEXT REFERENCES users(id),
    received_by TEXT REFERENCES users(id),
    remarks TEXT
);

-- 4. FLOOR PROCESS LOGS (STITCHING, FINISHING & QC TELEMETRY)
CREATE TABLE IF NOT EXISTS floor_process_logs (
    id TEXT PRIMARY KEY,
    production_order_no TEXT NOT NULL REFERENCES production_orders(production_order_no),
    process_name TEXT NOT NULL, -- 'Stitching', 'Thread_Cutting', 'Kaaj', 'Button', 'Eyelet', 'Bartack', 'Heatseal', 'Ironing', 'QC_Inspection'
    operator_id TEXT NOT NULL REFERENCES users(id),
    station_code TEXT, -- e.g. 'LINE-1', 'FIN-STATION-3', 'QC-TABLE-1'
    log_date DATE DEFAULT (DATE('now')),
    completed_qty INTEGER NOT NULL,
    rejected_qty INTEGER DEFAULT 0,
    rework_qty INTEGER DEFAULT 0,
    defect_category TEXT, -- 'Stitching_Pucker', 'Broken_Stitch', 'Needle_Hole', 'Stain', 'Button_Loose', 'Measurement_Off'
    size_breakdown_json TEXT, -- {"S": 10, "M": 20, "L": 20}
    remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. CARTON PACKING & SHIPMENT TELEMETRY
CREATE TABLE IF NOT EXISTS carton_packings (
    id TEXT PRIMARY KEY,
    carton_no TEXT NOT NULL UNIQUE, -- e.g. BOX-26001-01
    production_order_no TEXT NOT NULL REFERENCES production_orders(production_order_no),
    box_type TEXT DEFAULT '7-Ply Master Carton',
    gross_weight_kg REAL,
    size_breakdown_json TEXT NOT NULL, -- {"S": 10, "M": 20, "L": 20}
    total_pcs INTEGER NOT NULL,
    packed_by TEXT NOT NULL REFERENCES users(id),
    status TEXT DEFAULT 'Sealed' CHECK (status IN ('Open', 'Sealed', 'In_Transit_Dispatch', 'Dispatched')),
    destination_address TEXT,
    remarks TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for lightning fast lookups
CREATE INDEX IF NOT EXISTS idx_cutting_order ON cutting_jobs(production_order_no);
CREATE INDEX IF NOT EXISTS idx_transit_order ON material_transits(production_order_no);
CREATE INDEX IF NOT EXISTS idx_transit_status ON material_transits(transit_status);
CREATE INDEX IF NOT EXISTS idx_challan_order ON subcontractor_challans(production_order_no);
CREATE INDEX IF NOT EXISTS idx_process_order ON floor_process_logs(production_order_no);
CREATE INDEX IF NOT EXISTS idx_process_name ON floor_process_logs(process_name);
CREATE INDEX IF NOT EXISTS idx_carton_order ON carton_packings(production_order_no);
-- FPCC Cortex: CRM, Finance & WhatsApp Integration Schema Migration
-- Supports: Lean CRM inquiries, Costing & 4x MRP simulator, Tax Invoices & Payments, and WhatsApp ChatOps & Notification Logs

-- 1. CRM LEADS & INQUIRIES
CREATE TABLE IF NOT EXISTS crm_inquiries (
    id TEXT PRIMARY KEY,
    inquiry_no TEXT NOT NULL UNIQUE, -- e.g. INQ-261014-01
    client_id TEXT REFERENCES entities(id),
    client_name TEXT NOT NULL,
    contact_person TEXT,
    phone TEXT NOT NULL,
    email TEXT,
    category TEXT NOT NULL DEFAULT 'Apparel', -- 'Apparel', 'Non-Apparel'
    sub_category TEXT NOT NULL DEFAULT 'Polo', -- 'Polo', 'Round_Neck', 'Hoodie', 'Sweatshirt', 'Drinkware', 'Bags', 'Cap'
    product_name TEXT NOT NULL,
    target_qty INTEGER NOT NULL,
    target_budget_per_pc REAL,
    status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Sampling', 'Quoted', 'Converted_To_Order', 'Lost')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. COSTING & QUOTATIONS (FPCC COSTING ENGINE: 4x MRP & INDIAN GST RULES)
CREATE TABLE IF NOT EXISTS quotations_costing (
    id TEXT PRIMARY KEY,
    quotation_no TEXT NOT NULL UNIQUE, -- e.g. QT-261014-01
    inquiry_id TEXT REFERENCES crm_inquiries(id),
    client_id TEXT REFERENCES entities(id),
    client_name TEXT NOT NULL,
    product_name TEXT NOT NULL,
    color_name TEXT NOT NULL,
    sample_no TEXT,
    qty INTEGER NOT NULL,
    -- Cost breakdown
    fabric_rate_per_kg REAL NOT NULL DEFAULT 340.0,
    fabric_avg_kg_per_pc REAL NOT NULL DEFAULT 0.220,
    fabric_cost_per_pc REAL NOT NULL, -- fabric_rate * fabric_avg
    accessories_cost_per_pc REAL DEFAULT 15.0,
    cutting_cost_per_pc REAL DEFAULT 8.0,
    stitching_cost_per_pc REAL DEFAULT 35.0,
    finishing_cost_per_pc REAL DEFAULT 12.0,
    branding_cost_per_pc REAL DEFAULT 25.0,
    rejection_buffer_pct REAL DEFAULT 5.0, -- 5% buffer
    total_production_cost REAL NOT NULL, -- sum of operations + 5% buffer
    -- Pricing & Margins
    target_mrp REAL NOT NULL, -- 4x total_production_cost
    selling_price_per_pc REAL NOT NULL,
    tax_rate_pct REAL NOT NULL DEFAULT 5.0, -- 5% (<2500) or 12% (>2500) or 18%
    tax_billing TEXT NOT NULL DEFAULT 'extra' CHECK (tax_billing IN ('included', 'extra')),
    tax_amount_per_pc REAL NOT NULL,
    profit_inr_per_pc REAL NOT NULL,
    profit_pct REAL NOT NULL,
    total_order_value_inr REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'Approved' CHECK (status IN ('Draft', 'Sent', 'Approved', 'Rejected')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. SALES INVOICES & BILLING
CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoice_no TEXT NOT NULL UNIQUE, -- e.g. INV-261014-01
    production_order_no TEXT NOT NULL REFERENCES production_orders(production_order_no),
    client_id TEXT NOT NULL REFERENCES entities(id),
    client_name TEXT NOT NULL,
    invoice_date DATE DEFAULT (DATE('now')),
    due_date DATE,
    subtotal_amount REAL NOT NULL,
    gst_rate_pct REAL NOT NULL DEFAULT 5.0,
    gst_amount REAL NOT NULL,
    freight_amount REAL DEFAULT 0.0,
    total_amount REAL NOT NULL,
    amount_paid REAL DEFAULT 0.0,
    balance_due REAL NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'Unpaid' CHECK (payment_status IN ('Unpaid', 'Partially_Paid', 'Paid', 'Overdue')),
    e_way_bill_no TEXT,
    carrier TEXT,
    docket_no TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. PAYMENTS & ACCOUNTS RECEIVABLE
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    payment_no TEXT NOT NULL UNIQUE, -- e.g. PAY-261014-01
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    client_id TEXT NOT NULL REFERENCES entities(id),
    payment_date DATE DEFAULT (DATE('now')),
    amount REAL NOT NULL,
    payment_mode TEXT NOT NULL DEFAULT 'NEFT_RTGS' CHECK (payment_mode IN ('NEFT_RTGS', 'UPI', 'Cheque', 'Cash')),
    reference_no TEXT, -- UTR or Cheque no
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. WHATSAPP CHATOPS & NOTIFICATION LOGS
CREATE TABLE IF NOT EXISTS whatsapp_logs (
    id TEXT PRIMARY KEY,
    direction TEXT NOT NULL CHECK (direction IN ('OUTBOUND', 'INBOUND')),
    phone_number TEXT NOT NULL,
    recipient_name TEXT,
    message_type TEXT NOT NULL, -- 'ORDER_CONFIRMATION', 'PO_DISPATCH', 'RUNNER_ALERT', 'SHIPMENT_DISPATCH', 'INTERACTIVE_COMMAND', 'STATUS_INQUIRY', 'GENERAL'
    template_name TEXT,
    message_body TEXT NOT NULL,
    related_entity_type TEXT, -- 'Order', 'Transit', 'PO', 'Invoice'
    related_entity_id TEXT,
    status TEXT NOT NULL DEFAULT 'DELIVERED' CHECK (status IN ('SENT', 'DELIVERED', 'RECEIVED', 'PROCESSED', 'FAILED')),
    response_payload TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_inquiry_client ON crm_inquiries(client_id);
CREATE INDEX IF NOT EXISTS idx_quotation_client ON quotations_costing(client_id);
CREATE INDEX IF NOT EXISTS idx_invoice_order ON invoices(production_order_no);
CREATE INDEX IF NOT EXISTS idx_invoice_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_payment_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_phone ON whatsapp_logs(phone_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_type ON whatsapp_logs(message_type);
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
