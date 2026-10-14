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
