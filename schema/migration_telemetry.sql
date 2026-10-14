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
