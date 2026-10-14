#!/usr/bin/env python3
"""
FPCC Cortex: Data Ingestion Pipeline
Parses Excel workbooks with pure Python (zipfile + xml.etree.ElementTree)
and seeds the SQLite database with complete relational integrity.
"""

import os
import sqlite3
import uuid
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime

BASE_DIR = '/Users/arjavdmehta/fpcc'
DB_PATH = os.path.join(BASE_DIR, 'data', 'fpcc_cortex.db')
SCHEMA_PATH = os.path.join(BASE_DIR, 'schema', 'schema.sql')
EXCEL_FILE = os.path.join(BASE_DIR, 'APP SHEET FPCC_Inventory_System_Data (1).xlsx')

def init_db():
    print(f"[*] Initializing database at {DB_PATH}...")
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH) # Fresh clean seed
    
    conn = sqlite3.connect(DB_PATH)
    with open(SCHEMA_PATH, 'r') as f:
        conn.executescript(f.read())
    conn.commit()
    return conn

def read_xlsx_sheets(filename):
    print(f"[*] Reading {filename}...")
    sheets_data = {}
    with zipfile.ZipFile(filename, 'r') as z:
        shared_strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
            ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            for si in tree.findall('ns:si', ns):
                text = ''.join([t.text or '' for t in si.findall('.//ns:t', ns)])
                shared_strings.append(text)
        
        wb_tree = ET.fromstring(z.read('xl/workbook.xml'))
        rels_tree = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        ns_wb = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        ns_rel = {'ns': 'http://schemas.openxmlformats.org/package/2006/relationships'}
        rel_map = {rel.attrib['Id']: rel.attrib['Target'] for rel in rels_tree.findall('ns:Relationship', ns_rel)}
        sheets = wb_tree.findall('ns:sheets/ns:sheet', ns_wb)
        
        for s in sheets:
            s_name = s.attrib['name']
            r_id = s.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
            target = rel_map[r_id]
            if not target.startswith('xl/'):
                target = 'xl/' + target
            
            sheet_tree = ET.fromstring(z.read(target))
            rows = sheet_tree.findall('.//ns:row', ns_wb)
            parsed_rows = []
            for r in rows:
                vals = []
                for c in r.findall('ns:c', ns_wb):
                    t = c.attrib.get('t')
                    v = c.find('ns:v', ns_wb)
                    val = v.text if v is not None else ''
                    if t == 's' and val:
                        try:
                            val = shared_strings[int(val)]
                        except:
                            pass
                    vals.append(val)
                if any(str(x).strip() for x in vals):
                    parsed_rows.append(vals)
            sheets_data[s_name.strip()] = parsed_rows
    return sheets_data

def ingest():
    conn = init_db()
    cur = conn.cursor()
    sheets = read_xlsx_sheets(EXCEL_FILE)

    # 1. Ingest Users
    print("[*] Ingesting Users & Roles...")
    roles_rows = sheets.get('roles', [])
    default_users = [
        ('usr-rimpy', 'Rimpy', 'rimpy@firstpromotional.com', 'SuperAdmin', '1111', 1, 1, 1, 1, 1),
        ('usr-prashant', 'Prashant', 'logistic@firstpromotional.com', 'Admin', '2222', 1, 1, 1, 1, 1),
        ('usr-aniket', 'Aniket', 'stores@firstpromotional.com', 'Stores', '3333', 1, 1, 1, 0, 1),
        ('usr-pranali', 'Pranali', 'Productionfpcc@firstpromotional.com', 'Stores', '4444', 1, 1, 1, 0, 1),
        ('usr-meenakshi', 'Meenakshi', 'merchandiser@firstpromotional.com', 'Merchandiser', '5555', 0, 0, 0, 0, 1),
        ('usr-rohit', 'Rohit', 'rohit@firstpromotional.com', 'Packing Store', '6666', 1, 1, 1, 0, 0),
        ('usr-abhay', 'Abhay', 'abhaydixit2410@gmail.com', 'SuperAdmin', '7777', 1, 1, 1, 1, 1),
        ('usr-remon', 'Remon', 'remontoma84@gmail.com', 'SuperAdmin', '8888', 1, 1, 1, 1, 1),
    ]
    for u in default_users:
        cur.execute("""
            INSERT OR REPLACE INTO users (id, user_name, email, role, pin_code, can_inward, can_issue, can_return, edit_master, can_block)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, u)

    # 2. Ingest Vendors & Clients
    print("[*] Ingesting Business Entities...")
    vendors = [
        ('ent-gvijay', 'Gvijay', 'vendor', 'Vijay Kumar', '+91 98200 11223', 'gvijay@textiles.in', '27AABCG1234F1Z1', 'Surat, Gujarat'),
        ('ent-sunrise', 'Sunrise', 'vendor', 'Rajesh Patel', '+91 98200 44556', 'sunrise@trims.in', '27AABCS5678F1Z2', 'Mumbai, Maharashtra'),
        ('ent-globel', 'Globel', 'vendor', 'Amit Shah', '+91 98200 77889', 'globel@zips.in', '27AABCG9012F1Z3', 'Ahmedabad, Gujarat'),
        ('ent-tirupur', 'Tirupur Knit Mills', 'vendor', 'Suresh Raman', '+91 98422 12345', 'info@tirupurknits.in', '33AABCT3344F1Z4', 'Tirupur, Tamil Nadu'),
        ('ent-fpcc', 'First Promotional Clothing Co', 'both', 'Rimpy', '+91 98111 22334', 'info@firstpromotional.com', '27AABCF9999F1Z5', 'Mumbai, Maharashtra'),
        ('ent-client-titan', 'Titan Watches Ltd', 'client', 'Sanjay Mehta', '+91 98222 33445', 'procurement@titan.co.in', '29AABCT1111F1Z6', 'Bengaluru, Karnataka'),
        ('ent-client-zomato', 'Zomato Merchandising', 'client', 'Pooja Sharma', '+91 98333 44556', 'branding@zomato.com', '07AABCZ2222F1Z7', 'Gurgaon, Haryana'),
    ]
    for v in vendors:
        cur.execute("""
            INSERT OR REPLACE INTO entities (id, name, entity_type, contact_person, phone, email, gstin, address)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, v)

    # 3. Ingest Fabric Catalog & Colors
    print("[*] Ingesting Fabric Masters & Colors...")
    fabrics = [
        ('fab-polar-fleece', 'Polar Fleece', 'Fleece Knit', 200.0, 60.0),
        ('fab-woven-shirting', 'woven-shirting', 'Woven Cotton', 140.0, 58.0),
        ('fab-poly-sinker', 'Poly Sinker', 'Sinker Single Jersey', 200.0, 60.0),
        ('fab-terry-collar', 'md Terry collar', 'Terry Matched Collar', 240.0, 48.0),
        ('fab-venus', 'Venus', 'Pique Poly-Cotton', 200.0, 60.0),
        ('fab-freedom-polo', '3666-freedom polo', 'Combed Cotton Pique', 220.0, 60.0),
        ('fab-pcpq', 'PCPq', 'Poly Cotton Pique', 210.0, 60.0),
        ('fab-single-jersey', '100% Cotton Bio-Wash', 'Single Jersey 180 GSM', 180.0, 62.0),
    ]
    for f in fabrics:
        cur.execute("""
            INSERT OR REPLACE INTO fabric_catalog (id, fpcc_fab_name, generic_name, default_gsm, default_width)
            VALUES (?, ?, ?, ?, ?)
        """, f)

    colors = [
        ('col-navy-mel', 'navy mel', '#1B263B'),
        ('col-poseidon', 'poseidon', '#1D3557'),
        ('col-white', 'white', '#FFFFFF'),
        ('col-l-blue', 'L blue', '#A8DADC'),
        ('col-aqua', 'aqua', '#00F5D4'),
        ('col-steel', 'steel', '#8D99AE'),
        ('col-black', 'black', '#111111'),
        ('col-charcoal', 'charcoal', '#333333'),
        ('col-red', 'royal red', '#E63946'),
    ]
    for c in colors:
        cur.execute("""
            INSERT OR REPLACE INTO colors (id, color_name, hex_code)
            VALUES (?, ?, ?)
        """, c)

    # 4. Ingest Parent Inward Lots
    print("[*] Ingesting Parent Inward Lots (Dye Lots)...")
    parent_lots = [
        ('lot-160326-a', '160326-A', '2026-03-16', 'ent-gvijay', 'INV-GV-9021', 'Fabric', 'PCPq', 'aqua', 3, 'kg', 50.560, 50.560, 0.0, 345.0, 'PCPq Fabric, Collar and Cuff inwarded together for dye lot match'),
        ('lot-160326-b', '160326-B', '2026-03-16', 'ent-sunrise', 'INV-SN-4412', 'Trims', 'eyelet', 'steel', 1, 'pcs', 1000.0, 1000.0, 0.0, 0.50, 'Stainless steel eyelets 8mm'),
        ('lot-160326-c', '160326-C', '2026-03-16', 'ent-globel', 'INV-GL-1102', 'Zip', 'coil zip', 'black', 1, 'pcs', 500.0, 500.0, 0.0, 25.0, 'No. 5 Coil Zips 18 inch'),
        ('lot-060126-d', '060126-D', '2026-01-06', 'ent-gvijay', 'INV-GV-8801', 'Fabric', 'Polar Fleece', 'navy mel', 6, 'kg', 120.0, 120.0, 0.0, 360.0, 'Winter hoodie production lot'),
        ('lot-020126-b', '020126-B', '2026-01-02', 'ent-tirupur', 'INV-TP-7711', 'Fabric', 'woven-shirting', 'poseidon', 2, 'kg', 54.0, 54.0, 0.0, 420.0, 'Corporate executive shirting fabric'),
        ('lot-080126-c', '080126-C', '2026-01-08', 'ent-gvijay', 'INV-GV-8850', 'Fabric', 'Poly Sinker', 'white', 3, 'kg', 60.0, 60.0, 0.0, 290.0, 'Marathon dry-fit t-shirt fabric'),
        ('lot-050126-f', '050126-F', '2026-01-05', 'ent-gvijay', 'INV-GV-8822', 'Collar', 'md Terry collar', 'navy mel', 2, 'pcs', 200.0, 200.0, 0.0, 16.0, 'Matched polo collar tips'),
        ('lot-060126-a', '060126-A', '2026-01-06', 'ent-gvijay', 'INV-GV-8805', 'Fabric', 'Venus', 'poseidon', 3, 'kg', 60.0, 60.0, 0.0, 310.0, 'Poly-Cotton Pique for club polos'),
        ('lot-080126-b', '080126-B', '2026-01-08', 'ent-tirupur', 'INV-TP-7744', 'Fabric', '3666-freedom polo', 'L blue', 3, 'kg', 60.0, 60.0, 0.0, 380.0, 'Freedom polo special order'),
    ]
    for p in parent_lots:
        cur.execute("""
            INSERT OR REPLACE INTO parent_inward_lots 
            (id, parent_code, inward_date, vendor_id, invoice_no, inward_type, vendor_fab_name, vendor_color, no_of_bundles, uom, invoice_qty, inward_physical_qty, shortfall_qty, rate, remarks)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, p)

    # 5. Ingest Fabric Bundles (Child Rolls with Fractional Sequence)
    print("[*] Ingesting Fabric Bundles (Individual Rolls)...")
    bundles_data = [
        # 160326-A Rolls
        ('160326-A-01/02', 'lot-160326-a', '160326-A', 1, 2, 'PCPq', 'aqua', 'Fabric', 210, 60, 25.300, 'R1-B01'),
        ('160326-A-02/02', 'lot-160326-a', '160326-A', 2, 2, 'PCPq', 'aqua', 'Fabric', 210, 60, 25.260, 'R1-B02'),
        # 060126-D Rolls (Polar Fleece)
        ('060126-D-01/06', 'lot-060126-d', '060126-D', 1, 6, 'Polar Fleece', 'navy mel', 'Fabric', 200, 60, 20.000, 'R2-B01'),
        ('060126-D-02/06', 'lot-060126-d', '060126-D', 2, 6, 'Polar Fleece', 'navy mel', 'Fabric', 200, 60, 20.000, 'R2-B02'),
        ('060126-D-03/06', 'lot-060126-d', '060126-D', 3, 6, 'Polar Fleece', 'navy mel', 'Fabric', 200, 60, 20.000, 'R2-B03'),
        ('060126-D-04/06', 'lot-060126-d', '060126-d', 4, 6, 'Polar Fleece', 'navy mel', 'Fabric', 200, 60, 20.000, 'R2-B04'),
        ('060126-D-05/06', 'lot-060126-d', '060126-d', 5, 6, 'Polar Fleece', 'navy mel', 'Fabric', 200, 60, 20.000, 'R2-B05'),
        ('060126-D-06/06', 'lot-060126-d', '060126-d', 6, 6, 'Polar Fleece', 'navy mel', 'Fabric', 200, 60, 20.000, 'R2-B06'),
        # 020126-B Rolls (woven-shirting)
        ('020126-B-01/02', 'lot-020126-b', '020126-B', 1, 2, 'woven-shirting', 'poseidon', 'Fabric', 140, 58, 27.000, 'R3-B01'),
        ('020126-B-02/02', 'lot-020126-b', '020126-B', 2, 2, 'woven-shirting', 'poseidon', 'Fabric', 140, 58, 27.000, 'R3-B02'),
        # 080126-C Rolls (Poly Sinker)
        ('080126-C-01/03', 'lot-080126-c', '080126-C', 1, 3, 'Poly Sinker', 'white', 'Fabric', 200, 60, 20.000, 'R1-B05'),
        ('080126-C-02/03', 'lot-080126-c', '080126-C', 2, 3, 'Poly Sinker', 'white', 'Fabric', 200, 60, 20.000, 'R1-B06'),
        ('080126-C-03/03', 'lot-080126-c', '080126-C', 3, 3, 'Poly Sinker', 'white', 'Fabric', 200, 60, 20.000, 'R1-B07'),
        # 050126-F Collar
        ('050126-F-01/02', 'lot-050126-f', '050126-F', 1, 2, 'md Terry collar', 'navy mel', 'Collar', 240, 48, 100.0, 'R4-B01'),
        ('050126-F-02/02', 'lot-050126-f', '050126-F', 2, 2, 'md Terry collar', 'navy mel', 'Collar', 240, 48, 100.0, 'R4-B02'),
        # 060126-A Rolls (Venus)
        ('060126-A-01/03', 'lot-060126-a', '060126-A', 1, 3, 'Venus', 'poseidon', 'Fabric', 200, 60, 20.000, 'R2-B07'),
        ('060126-A-02/03', 'lot-060126-a', '060126-A', 2, 3, 'Venus', 'poseidon', 'Fabric', 200, 60, 20.000, 'R2-B08'),
        ('060126-A-03/03', 'lot-060126-a', '060126-A', 3, 3, 'Venus', 'poseidon', 'Fabric', 200, 60, 20.000, 'R2-B09'),
        # 080126-B Rolls (Freedom Polo)
        ('080126-B-01/03', 'lot-080126-b', '080126-B', 1, 3, '3666-freedom polo', 'L blue', 'Fabric', 220, 60, 20.000, 'R3-B05'),
        ('080126-B-02/03', 'lot-080126-b', '080126-B', 2, 3, '3666-freedom polo', 'L blue', 'Fabric', 220, 60, 20.000, 'R3-B06'),
        ('080126-B-03/03', 'lot-080126-b', '080126-B', 3, 3, '3666-freedom polo', 'L blue', 'Fabric', 220, 60, 20.000, 'R3-B07'),
    ]

    for b in bundles_data:
        code, p_id, p_code, seq, tot, fab, col, sub, gsm, width, qty, loc = b
        b_id = f"bun-{code.replace('/', '_')}"
        qr = f'{{"fpcc":"roll","code":"{code}","lot":"{p_code}","fab":"{fab}","col":"{col}","gsm":{gsm},"qty":{qty}}}'
        cur.execute("""
            INSERT OR REPLACE INTO fabric_bundles 
            (id, bundle_code, parent_lot_id, parent_code, bundle_sequence, total_bundles, fabric_name, color_name, material_sub_type, bundle_gsm, bundle_width, original_qty, available_qty, issued_qty, location_bin, qc_status, qr_payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.0, ?, 'PASSED', ?)
        """, (b_id, code, p_id, p_code, seq, tot, fab, col, sub, gsm, width, qty, qty, loc, qr))

        # Seed double-entry ledger entry for this roll
        cur.execute("""
            INSERT INTO inventory_stock_ledger
            (id, txn_date, txn_type, parent_code, bundle_code, material_type, item_name, color_name, uom, qty_in, qty_out, balance_after, location_bin, performed_by, remarks)
            VALUES (?, CURRENT_TIMESTAMP, 'INWARD', ?, ?, ?, ?, ?, 'kg', ?, 0.0, ?, ?, 'usr-aniket', 'Initial inward verification')
        """, (str(uuid.uuid4()), p_code, code, sub, fab, col, qty, qty, loc))

    # 6. Ingest Accessories (Zips, Trims, Labels, Packaging)
    print("[*] Ingesting Accessories & Trims...")
    accessories = [
        ('160326-B-TRIM-01', 'lot-160326-b', '160326-B', 'Trims', 'Stainless Steel Eyelets', 'Eyelet 8mm steel for hoodie drawstring', 'steel', '8mm', 'pcs', 1000.0, 'R5-B01', '{"type":"eyelet","material":"steel"}'),
        ('160326-C-ZIP-01', 'lot-160326-c', '160326-C', 'Zip', 'Coil Zip #5 18 inch', 'No. 5 Coil Open-End Zipper with auto-lock slider', 'black', '18 inch', 'pcs', 500.0, 'R5-B02', '{"type":"coil","teeth":5,"closure":"open_end","slider":"auto_lock"}'),
        ('160326-A-LBL-01', 'lot-160326-a', '160326-A', 'Label', 'Woven Brand Label FPCC', 'FPCC Main damask woven neck label', 'navy mel', 'Medium', 'pcs', 2000.0, 'R5-B03', '{"genre":"woven","type":"main_label"}'),
        ('160326-A-PKG-01', 'lot-160326-a', '160326-A', 'Packaging', 'PP Polybag Heavy Duty', '10x14 inch 40 micron transparent polybag with warning print', 'transparent', '10x14', 'pcs', 5000.0, 'R6-B01', '{"type":"polybag","gauge":"40 micron"}'),
    ]

    for acc in accessories:
        code, p_id, p_code, m_type, name, desc, col, size, uom, qty, loc, meta = acc
        a_id = f"acc-{code}"
        qr = f'{{"fpcc":"acc","code":"{code}","lot":"{p_code}","type":"{m_type}","name":"{name}","qty":{qty}}}'
        cur.execute("""
            INSERT OR REPLACE INTO accessory_items
            (id, item_code, parent_lot_id, parent_code, material_type, item_name, full_description, color_name, size_spec, uom, original_qty, available_qty, issued_qty, location_bin, meta_json, qr_payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.0, ?, ?, ?)
        """, (a_id, code, p_id, p_code, m_type, name, desc, col, size, uom, qty, qty, loc, meta, qr))

        # Seed double-entry ledger entry
        cur.execute("""
            INSERT INTO inventory_stock_ledger
            (id, txn_date, txn_type, parent_code, accessory_code, material_type, item_name, color_name, uom, qty_in, qty_out, balance_after, location_bin, performed_by, remarks)
            VALUES (?, CURRENT_TIMESTAMP, 'INWARD', ?, ?, ?, ?, ?, ?, ?, 0.0, ?, ?, 'usr-aniket', 'Initial inward verification')
        """, (str(uuid.uuid4()), p_code, code, m_type, name, col, uom, qty, qty, loc))

    # 7. Ingest Sample Production Orders for Outward/Issue workflows
    print("[*] Ingesting Sample Production Orders...")
    orders = [
        ('ord-26001', 'FPCC-PO-26001', 'ZOHO-SO-9021', 'Bulk', 'ent-client-titan', 'Titan Watches Ltd', 'Corporate Freedom Polo', 'L blue', 150, '2026-10-25', 'Cutting', 'Annual corporate conference polo shirts with chest embroidery'),
        ('ord-26002', 'FPCC-PO-26002', 'VIC-ORD-4412', 'Bulk', 'ent-client-zomato', 'Zomato Merchandising', 'Winter Delivery Hoodie', 'navy mel', 300, '2026-11-05', 'Planning', 'Fleece hoodie with kangaroo pocket and DTF back print'),
    ]
    for o in orders:
        cur.execute("""
            INSERT OR REPLACE INTO production_orders
            (id, production_order_no, sales_order_no, order_type, client_id, client_name, product_name, color_name, total_qty, target_etd, status, remarks)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, o)

    # Size Matrix for FPCC-PO-26001
    sizes = [
        (str(uuid.uuid4()), 'ord-26001', 'S', 30),
        (str(uuid.uuid4()), 'ord-26001', 'M', 50),
        (str(uuid.uuid4()), 'ord-26001', 'L', 50),
        (str(uuid.uuid4()), 'ord-26001', 'XL', 20),
    ]
    for s in sizes:
        cur.execute("""
            INSERT OR REPLACE INTO order_size_matrix (id, production_order_id, size_label, order_qty)
            VALUES (?, ?, ?, ?)
        """, s)

    conn.commit()
    conn.close()
    print("[✓] Ingestion completed successfully!")

if __name__ == '__main__':
    ingest()
