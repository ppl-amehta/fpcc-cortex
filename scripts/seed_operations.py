#!/usr/bin/env python3
"""
Seed operational telemetry data for FPCC Cortex:
Cutting jobs, Runner transits, Subcontractor branding challans,
Floor process logs (Stitching, T/C, Kaaj, Button, QC), and Carton packing.
"""

import sqlite3
import json
import os

db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'fpcc_cortex.db'))
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# 1. Seed Cutting Job for FPCC-PO-26001 (Freedom Polo, 150 pcs)
# Cut from roll 080126-B-01/03 (3666-freedom polo, L blue)
print("[*] Seeding cutting job...")
cut_job = (
    'cut-demo-01',
    'CUT-261014-01',
    'FPCC-PO-26001',
    '080126-B-01/03',
    'usr-santosh',
    1,
    5.2,
    30,
    6, # 6 sample palla pcs
    1.260, # 1.260 kg sample palla weight -> 0.2100 kg/pc average
    0.2100,
    33.600, # 33.600 kg total fabric used
    160, # 160 pcs cut (150 ordered + 10 buffer)
    json.dumps({"S": 32, "M": 54, "L": 54, "XL": 20}),
    0.2100,
    0.2200, # planned BOM was 0.2200
    -4.55, # 4.55% better yield than planned!
    'Lay 1 cut smoothly. Excellent marker efficiency on combed pique.'
)

cur.execute("""
    INSERT OR REPLACE INTO cutting_jobs (
        id, cut_job_no, production_order_no, bundle_code, cutter_id,
        lay_no, lay_length_meters, plies_count, sample_palla_pcs, sample_palla_weight_kg,
        calculated_palla_avg_kg, total_fabric_weight_used_kg, total_pcs_cut,
        size_breakdown_json, actual_consumption_per_pc, target_bom_consumption,
        variance_pct, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
""", cut_job)

# Update order_size_matrix cut quantities
for size, cut_qty in [('S', 32), ('M', 54), ('L', 54), ('XL', 20)]:
    cur.execute("""
        UPDATE order_size_matrix 
        SET cut_qty = ? 
        WHERE production_order_id = 'ord-26001' AND size_label = ?
    """, (cut_qty, size))

# 2. Seed Subcontractor Challan for Chest Embroidery
print("[*] Seeding subcontractor branding challan...")
challan = (
    'ch-demo-01',
    'CH-261014-01',
    'FPCC-PO-26001',
    'ent-sunrise',
    'Branding',
    'Embroidery',
    'Front_Chest',
    160, # 160 cut front panels sent
    '2026-10-14 10:00:00',
    '2026-10-16',
    158, # 158 good panels received back
    '2026-10-14 16:30:00',
    2, # 2 rejections
    'Needle cut & thread fray on left chest logo',
    0,
    'https://images.unsplash.com/photo-1576995853123-5a10305d93c0?auto=format&fit=crop&w=400&q=80',
    'Completed',
    'usr-meenakshi',
    'usr-aniket',
    'High quality 9000 stitch chest embroidery. 2 panels spoiled at machine setup.'
)

cur.execute("""
    INSERT OR REPLACE INTO subcontractor_challans (
        id, challan_no, production_order_no, vendor_id, process_type,
        branding_type, panel_name, qty_sent, date_sent, expected_eta,
        qty_received, actual_received_date, rejection_qty, rejection_reason,
        rework_qty, defect_photo_url, status, created_by, received_by, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
""", challan)

# 3. Seed Runner Transits
print("[*] Seeding runner material transits...")
# Transit 1: Cutting Table -> Branding Gate (Delivered Verified)
transit1 = (
    'trn-demo-01',
    'TRN-261014-01',
    'FPCC-PO-26001',
    'Cutting',
    'Branding',
    'usr-ramesh',
    'Cut_Panels',
    'CUT-261014-01',
    160,
    'usr-santosh',
    '2026-10-14 09:30:00',
    '2026-10-14 09:40:00',
    160,
    'usr-meenakshi',
    '2026-10-14 09:55:00',
    'DELIVERED_VERIFIED',
    0,
    None,
    'Handed over 160 bundles of front panels to embroidery coordinator'
)

# Transit 2: Branding Gate -> Stitching Line 1 (In-Transit right now!)
transit2 = (
    'trn-demo-02',
    'TRN-261014-02',
    'FPCC-PO-26001',
    'Branding',
    'Stitching',
    'usr-mukesh',
    'Cut_Panels',
    'CH-261014-01',
    158,
    'usr-meenakshi',
    '2026-10-14 16:45:00',
    '2026-10-14 16:50:00',
    None,
    None,
    None,
    'IN_TRANSIT',
    0,
    None,
    'Transporting 158 embroidered front panels + matching back panels to Line 1'
)

for t in [transit1, transit2]:
    cur.execute("""
        INSERT OR REPLACE INTO material_transits (
            id, transit_pass_no, production_order_no, source_station, dest_station,
            runner_id, item_type, item_ref, dispatched_qty, dispatched_by,
            dispatched_at, picked_up_at, received_qty, received_by, received_at,
            transit_status, variance_qty, discrepancy_reason, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, t)

# 4. Seed Floor Process Logs (Stitching, T/C, Kaaj, Button, Ironing, QC)
print("[*] Seeding floor process logs...")
process_logs = [
    ('proc-demo-01', 'FPCC-PO-26001', 'Stitching', 'usr-suresh', 'LINE-1', 100, 2, 1, 'Needle_Hole', json.dumps({"S": 20, "M": 35, "L": 35, "XL": 10}), 'First batch of 100 polos stitched on Line 1'),
    ('proc-demo-02', 'FPCC-PO-26001', 'Thread_Cutting', 'usr-dilip', 'FIN-STATION-1', 100, 0, 0, None, None, 'All 100 pcs thread trimmed'),
    ('proc-demo-03', 'FPCC-PO-26001', 'Kaaj', 'usr-dilip', 'FIN-STATION-2', 100, 0, 0, None, None, 'Polo placket buttonholes punched'),
    ('proc-demo-04', 'FPCC-PO-26001', 'Button', 'usr-dilip', 'FIN-STATION-3', 100, 1, 0, 'Button_Loose', None, 'Buttons attached. 1 pc needs re-stitch'),
    ('proc-demo-05', 'FPCC-PO-26001', 'Ironing', 'usr-dilip', 'IRON-TABLE-1', 99, 0, 0, None, None, 'Steam pressed and placed on hanger'),
    ('proc-demo-06', 'FPCC-PO-26001', 'QC_Inspection', 'usr-dilip', 'QC-TABLE-1', 98, 1, 0, 'Measurement_Off', None, '1 pc chest measurement 1 inch short')
]

for pl in process_logs:
    cur.execute("""
        INSERT OR REPLACE INTO floor_process_logs (
            id, production_order_no, process_name, operator_id, station_code,
            completed_qty, rejected_qty, rework_qty, defect_category,
            size_breakdown_json, remarks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, pl)

# Update order_size_matrix finished quantities
for size, fin_qty in [('S', 20), ('M', 35), ('L', 35), ('XL', 10)]:
    cur.execute("""
        UPDATE order_size_matrix 
        SET finished_qty = ? 
        WHERE production_order_id = 'ord-26001' AND size_label = ?
    """, (fin_qty, size))

# 5. Seed Carton Packing
print("[*] Seeding carton packing...")
carton = (
    'box-demo-01',
    'BOX-261014-01',
    'FPCC-PO-26001',
    '7-Ply Heavy Master Box',
    11.45,
    json.dumps({"S": 10, "M": 20, "L": 15, "XL": 5}),
    50, # 50 pcs packed in carton 1
    'usr-rohit',
    'Sealed',
    'Titan Watches Ltd, Electronic City, Bangalore',
    'Master carton 1 of 3. Polybagged with silica gel.'
)

cur.execute("""
    INSERT OR REPLACE INTO carton_packings (
        id, carton_no, production_order_no, box_type, gross_weight_kg,
        size_breakdown_json, total_pcs, packed_by, status, destination_address, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
""", carton)

for size, packed_qty in [('S', 10), ('M', 20), ('L', 15), ('XL', 5)]:
    cur.execute("""
        UPDATE order_size_matrix 
        SET packed_qty = ? 
        WHERE production_order_id = 'ord-26001' AND size_label = ?
    """, (packed_qty, size))

# 7. Seed Standard Product BOM Recipe Templates
bom_templates = [
    ('bom-polo-matty', 'Apparel', 'Polo', 'Matty Polo T-Shirt with Collar Jacquard', 'md Terry collar', 0.22, 1, 1, 2, 3, 0.8, 2, 1, 8.0, 38.0, 12.0, 22.0, 5.0),
    ('bom-roundneck-singlejersey', 'Apparel', 'Round_Neck', 'Combed Cotton Round Neck T-Shirt', 'Poly Sinker', 0.18, 0, 0, 0, 0, 0.6, 2, 1, 6.0, 24.0, 10.0, 18.0, 5.0),
    ('bom-hoodie-loopknit', 'Apparel', 'Hoodie', 'Overhead Heavyweight Fleece Hoodie', 'Polar Fleece', 0.45, 0, 0, 0, 0, 1.2, 2, 1, 12.0, 55.0, 15.0, 30.0, 5.0),
    ('bom-jacket-polarfleece', 'Apparel', 'Jacket', 'Full-Zip Polar Fleece Jacket', 'Polar Fleece', 0.42, 0, 0, 0, 0, 1.1, 2, 1, 14.0, 65.0, 18.0, 35.0, 5.0),
    ('bom-joggers-loopknit', 'Apparel', 'Joggers', 'Slim-Fit Loopknit Track Joggers', 'Poly Sinker', 0.38, 0, 0, 0, 0, 0.9, 2, 1, 10.0, 45.0, 14.0, 20.0, 5.0)
]

for t in bom_templates:
    cur.execute("""
        INSERT OR REPLACE INTO product_bom_templates (
            id, product_category, sub_category, product_name, default_fabric_name,
            default_fabric_consumption_kg, has_collar_cuff, collar_pieces_per_pc,
            cuff_pieces_per_pc, button_pieces_per_pc, thread_cones_per_100_pcs,
            label_pieces_per_pc, polybag_per_pc, standard_cutting_rate,
            standard_stitching_rate, standard_finishing_rate, standard_branding_rate,
            rejection_buffer_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, t)

conn.commit()
conn.close()
print("[✓] Operational telemetry and BOM templates seeded successfully!")
