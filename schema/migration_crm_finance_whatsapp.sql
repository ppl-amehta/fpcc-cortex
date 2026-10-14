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
