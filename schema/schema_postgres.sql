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
