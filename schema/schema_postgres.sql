-- FPCC Cortex: Canonical PostgreSQL 16+ DDL
-- Supports: Multi-Component Dye Lots, Fractional Roll Sequences, Perpetual Double-Entry Stock Ledger

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE,
    role VARCHAR(50) NOT NULL,
    pin_code VARCHAR(10) DEFAULT '1234',
    can_inward BOOLEAN DEFAULT TRUE,
    can_issue BOOLEAN DEFAULT TRUE,
    can_return BOOLEAN DEFAULT TRUE,
    edit_master BOOLEAN DEFAULT FALSE,
    can_block BOOLEAN DEFAULT FALSE,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('vendor', 'client', 'both')),
    contact_person VARCHAR(100),
    phone VARCHAR(30),
    email VARCHAR(100),
    gstin VARCHAR(20),
    address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fabric_catalog (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fpcc_fab_name VARCHAR(150) NOT NULL UNIQUE,
    generic_name VARCHAR(100),
    default_gsm NUMERIC(6, 2),
    default_width NUMERIC(6, 2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS colors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    color_name VARCHAR(100) NOT NULL UNIQUE,
    hex_code VARCHAR(7),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parent_inward_lots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_code VARCHAR(50) NOT NULL UNIQUE,
    inward_date DATE NOT NULL,
    vendor_id UUID NOT NULL REFERENCES entities(id),
    invoice_no VARCHAR(100) NOT NULL,
    inward_type VARCHAR(50) NOT NULL,
    vendor_fab_name VARCHAR(150),
    vendor_color VARCHAR(100),
    no_of_bundles INT DEFAULT 1,
    uom VARCHAR(20) NOT NULL DEFAULT 'kg',
    invoice_qty NUMERIC(12, 3) NOT NULL,
    inward_physical_qty NUMERIC(12, 3) DEFAULT 0.000,
    shortfall_qty NUMERIC(12, 3) GENERATED ALWAYS AS (invoice_qty - inward_physical_qty) STORED,
    rate NUMERIC(10, 2),
    remarks TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fabric_bundles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bundle_code VARCHAR(60) NOT NULL UNIQUE,
    parent_lot_id UUID NOT NULL REFERENCES parent_inward_lots(id) ON DELETE CASCADE,
    parent_code VARCHAR(50) NOT NULL,
    bundle_sequence INT NOT NULL,
    total_bundles INT NOT NULL,
    fabric_name VARCHAR(150) NOT NULL,
    color_name VARCHAR(100) NOT NULL,
    material_sub_type VARCHAR(30) DEFAULT 'Fabric',
    bundle_gsm NUMERIC(6, 2),
    bundle_width NUMERIC(6, 2),
    original_qty NUMERIC(12, 3) NOT NULL,
    available_qty NUMERIC(12, 3) NOT NULL,
    issued_qty NUMERIC(12, 3) DEFAULT 0.000,
    location_bin VARCHAR(50) NOT NULL,
    qc_status VARCHAR(20) DEFAULT 'PENDING',
    qc_done_by UUID REFERENCES users(id),
    qc_comment TEXT,
    qr_payload TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accessory_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_code VARCHAR(60) NOT NULL UNIQUE,
    parent_lot_id UUID NOT NULL REFERENCES parent_inward_lots(id) ON DELETE CASCADE,
    parent_code VARCHAR(50) NOT NULL,
    material_type VARCHAR(50) NOT NULL,
    item_name VARCHAR(150) NOT NULL,
    full_description TEXT NOT NULL,
    color_name VARCHAR(100),
    size_spec VARCHAR(50),
    uom VARCHAR(20) NOT NULL,
    original_qty NUMERIC(12, 3) NOT NULL,
    available_qty NUMERIC(12, 3) NOT NULL,
    issued_qty NUMERIC(12, 3) DEFAULT 0.000,
    location_bin VARCHAR(50),
    meta_json JSONB DEFAULT '{}'::jsonb,
    qr_payload TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS production_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    production_order_no VARCHAR(50) NOT NULL UNIQUE,
    sales_order_no VARCHAR(100),
    order_type VARCHAR(50) DEFAULT 'Bulk',
    client_id UUID REFERENCES entities(id),
    client_name VARCHAR(255) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    color_name VARCHAR(100) NOT NULL,
    total_qty INT NOT NULL,
    target_etd DATE,
    status VARCHAR(50) DEFAULT 'In_Progress',
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_size_matrix (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
    size_label VARCHAR(20) NOT NULL,
    order_qty INT NOT NULL,
    cut_qty INT DEFAULT 0,
    finished_qty INT DEFAULT 0,
    packed_qty INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventory_stock_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    txn_date TIMESTAMPTZ DEFAULT NOW(),
    txn_type VARCHAR(50) NOT NULL,
    parent_code VARCHAR(50) NOT NULL,
    bundle_code VARCHAR(60),
    accessory_code VARCHAR(60),
    production_order_no VARCHAR(50),
    material_type VARCHAR(50) NOT NULL,
    item_name VARCHAR(150) NOT NULL,
    color_name VARCHAR(100) NOT NULL,
    uom VARCHAR(20) NOT NULL DEFAULT 'kg',
    qty_in NUMERIC(12, 3) DEFAULT 0.000,
    qty_out NUMERIC(12, 3) DEFAULT 0.000,
    balance_after NUMERIC(12, 3) NOT NULL,
    location_bin VARCHAR(50),
    performed_by UUID REFERENCES users(id),
    remarks TEXT
);

CREATE INDEX IF NOT EXISTS idx_pg_parent_code ON parent_inward_lots(parent_code);
CREATE INDEX IF NOT EXISTS idx_pg_bundle_code ON fabric_bundles(bundle_code);
CREATE INDEX IF NOT EXISTS idx_pg_ledger_parent ON inventory_stock_ledger(parent_code);
CREATE INDEX IF NOT EXISTS idx_pg_ledger_order ON inventory_stock_ledger(production_order_no);

-- Operations & Telemetry
CREATE TABLE IF NOT EXISTS cutting_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cut_job_no VARCHAR(50) NOT NULL UNIQUE,
    production_order_no VARCHAR(50) NOT NULL,
    bundle_code VARCHAR(60) NOT NULL,
    cutter_id UUID NOT NULL REFERENCES users(id),
    lay_no INT DEFAULT 1,
    lay_length_meters NUMERIC(8, 2),
    plies_count INT,
    sample_palla_pcs INT NOT NULL,
    sample_palla_weight_kg NUMERIC(8, 3) NOT NULL,
    calculated_palla_avg_kg NUMERIC(8, 4) NOT NULL,
    total_fabric_weight_used_kg NUMERIC(10, 3) NOT NULL,
    total_pcs_cut INT NOT NULL,
    size_breakdown_json JSONB NOT NULL,
    actual_consumption_per_pc NUMERIC(8, 4) NOT NULL,
    target_bom_consumption NUMERIC(8, 4),
    variance_pct NUMERIC(6, 2),
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS material_transits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transit_pass_no VARCHAR(50) NOT NULL UNIQUE,
    production_order_no VARCHAR(50) NOT NULL,
    source_station VARCHAR(100) NOT NULL,
    dest_station VARCHAR(100) NOT NULL,
    runner_id UUID NOT NULL REFERENCES users(id),
    item_type VARCHAR(50) NOT NULL,
    item_ref VARCHAR(100),
    dispatched_qty INT NOT NULL,
    dispatched_by UUID NOT NULL REFERENCES users(id),
    dispatched_at TIMESTAMPTZ DEFAULT NOW(),
    picked_up_at TIMESTAMPTZ,
    received_qty INT,
    received_by UUID REFERENCES users(id),
    received_at TIMESTAMPTZ,
    transit_status VARCHAR(50) NOT NULL DEFAULT 'DISPATCHED',
    variance_qty INT DEFAULT 0,
    discrepancy_reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subcontractor_challans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    challan_no VARCHAR(50) NOT NULL UNIQUE,
    production_order_no VARCHAR(50) NOT NULL,
    vendor_id UUID NOT NULL REFERENCES entities(id),
    process_type VARCHAR(50) NOT NULL DEFAULT 'Branding',
    branding_type VARCHAR(50),
    panel_name VARCHAR(50) NOT NULL,
    qty_sent INT NOT NULL,
    date_sent TIMESTAMPTZ DEFAULT NOW(),
    expected_eta DATE,
    qty_received INT DEFAULT 0,
    actual_received_date TIMESTAMPTZ,
    rejection_qty INT DEFAULT 0,
    rejection_reason TEXT,
    rework_qty INT DEFAULT 0,
    defect_photo_url TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'Dispatched',
    created_by UUID REFERENCES users(id),
    received_by UUID REFERENCES users(id),
    remarks TEXT
);

CREATE TABLE IF NOT EXISTS floor_process_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    production_order_no VARCHAR(50) NOT NULL,
    process_name VARCHAR(50) NOT NULL,
    operator_id UUID NOT NULL REFERENCES users(id),
    station_code VARCHAR(50),
    log_date DATE DEFAULT CURRENT_DATE,
    completed_qty INT NOT NULL,
    rejected_qty INT DEFAULT 0,
    rework_qty INT DEFAULT 0,
    defect_category VARCHAR(100),
    size_breakdown_json JSONB,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carton_packings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    carton_no VARCHAR(50) NOT NULL UNIQUE,
    production_order_no VARCHAR(50) NOT NULL,
    box_type VARCHAR(100) DEFAULT '7-Ply Master Carton',
    gross_weight_kg NUMERIC(8, 3),
    size_breakdown_json JSONB NOT NULL,
    total_pcs INT NOT NULL,
    packed_by UUID NOT NULL REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'Sealed',
    destination_address TEXT,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CRM Leads & Inquiries
CREATE TABLE IF NOT EXISTS crm_inquiries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    inquiry_no VARCHAR(50) NOT NULL UNIQUE,
    client_id UUID REFERENCES entities(id),
    client_name VARCHAR(200) NOT NULL,
    contact_person VARCHAR(150),
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(150),
    category VARCHAR(50) NOT NULL DEFAULT 'Apparel',
    sub_category VARCHAR(50) NOT NULL DEFAULT 'Polo',
    product_name VARCHAR(200) NOT NULL,
    target_qty INT NOT NULL,
    target_budget_per_pc NUMERIC(10, 2),
    status VARCHAR(50) NOT NULL DEFAULT 'New',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Costing & Quotations (4x MRP)
CREATE TABLE IF NOT EXISTS quotations_costing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quotation_no VARCHAR(50) NOT NULL UNIQUE,
    inquiry_id UUID REFERENCES crm_inquiries(id),
    client_id UUID REFERENCES entities(id),
    client_name VARCHAR(200) NOT NULL,
    product_name VARCHAR(200) NOT NULL,
    color_name VARCHAR(100) NOT NULL,
    sample_no VARCHAR(50),
    qty INT NOT NULL,
    fabric_rate_per_kg NUMERIC(10, 2) NOT NULL DEFAULT 340.0,
    fabric_avg_kg_per_pc NUMERIC(8, 4) NOT NULL DEFAULT 0.220,
    fabric_cost_per_pc NUMERIC(10, 2) NOT NULL,
    accessories_cost_per_pc NUMERIC(10, 2) DEFAULT 15.0,
    cutting_cost_per_pc NUMERIC(10, 2) DEFAULT 8.0,
    stitching_cost_per_pc NUMERIC(10, 2) DEFAULT 35.0,
    finishing_cost_per_pc NUMERIC(10, 2) DEFAULT 12.0,
    branding_cost_per_pc NUMERIC(10, 2) DEFAULT 25.0,
    rejection_buffer_pct NUMERIC(5, 2) DEFAULT 5.0,
    total_production_cost NUMERIC(10, 2) NOT NULL,
    target_mrp NUMERIC(10, 2) NOT NULL,
    selling_price_per_pc NUMERIC(10, 2) NOT NULL,
    tax_rate_pct NUMERIC(5, 2) NOT NULL DEFAULT 5.0,
    tax_billing VARCHAR(20) NOT NULL DEFAULT 'extra',
    tax_amount_per_pc NUMERIC(10, 2) NOT NULL,
    profit_inr_per_pc NUMERIC(10, 2) NOT NULL,
    profit_pct NUMERIC(6, 2) NOT NULL,
    total_order_value_inr NUMERIC(12, 2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Approved',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Invoices & Sales Billing
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_no VARCHAR(50) NOT NULL UNIQUE,
    production_order_no VARCHAR(50) NOT NULL,
    client_id UUID NOT NULL REFERENCES entities(id),
    client_name VARCHAR(200) NOT NULL,
    invoice_date DATE DEFAULT CURRENT_DATE,
    due_date DATE,
    subtotal_amount NUMERIC(12, 2) NOT NULL,
    gst_rate_pct NUMERIC(5, 2) NOT NULL DEFAULT 5.0,
    gst_amount NUMERIC(12, 2) NOT NULL,
    freight_amount NUMERIC(10, 2) DEFAULT 0.0,
    total_amount NUMERIC(12, 2) NOT NULL,
    amount_paid NUMERIC(12, 2) DEFAULT 0.0,
    balance_due NUMERIC(12, 2) NOT NULL,
    payment_status VARCHAR(50) NOT NULL DEFAULT 'Unpaid',
    e_way_bill_no VARCHAR(50),
    carrier VARCHAR(100),
    docket_no VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_no VARCHAR(50) NOT NULL UNIQUE,
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    client_id UUID NOT NULL REFERENCES entities(id),
    payment_date DATE DEFAULT CURRENT_DATE,
    amount NUMERIC(12, 2) NOT NULL,
    payment_mode VARCHAR(50) NOT NULL DEFAULT 'NEFT_RTGS',
    reference_no VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- WhatsApp Logs
CREATE TABLE IF NOT EXISTS whatsapp_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    direction VARCHAR(20) NOT NULL,
    phone_number VARCHAR(30) NOT NULL,
    recipient_name VARCHAR(150),
    message_type VARCHAR(50) NOT NULL,
    template_name VARCHAR(100),
    message_body TEXT NOT NULL,
    related_entity_type VARCHAR(50),
    related_entity_id VARCHAR(50),
    status VARCHAR(30) NOT NULL DEFAULT 'DELIVERED',
    response_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
