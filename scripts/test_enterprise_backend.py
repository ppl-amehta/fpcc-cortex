#!/usr/bin/env python3
"""
Comprehensive End-to-End Enterprise Backend Test Suite for FPCC Cortex.
Tests all 11 enterprise domains across services, database transactions,
audit trails, and 2-way ChatOps automation.
"""

import sys
import json
import urllib.request
import urllib.error

BASE_URL = "http://localhost:3000/api"

def request(method, path, data=None, token=None, worker_pin=None, worker_id=None):
    url = f"{BASE_URL}{path}"
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if worker_pin:
        headers["x-worker-pin"] = worker_pin
    if worker_id:
        headers["x-worker-id"] = worker_id

    req_data = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return e.code, json.loads(body)
        except:
            return e.code, {"error": body}

def assert_true(condition, msg):
    if not condition:
        print(f"❌ ASSERTION FAILED: {msg}")
        sys.exit(1)
    print(f"  ✓ {msg}")

def main():
    print("=" * 60)
    print("🚀 FPCC CORTEX ENTERPRISE BACKEND END-TO-END VERIFICATION")
    print("=" * 60)

    # 1. Health Check
    print("\n[Stage 1] Verifying System Health & Core Engine...")
    status, res = request("GET", "/health")
    assert_true(status == 200 and res.get("status") == "ok", "System health returns 200 OK")
    print(f"  System: {res.get('system')} v{res.get('version')}")

    # 2. Authentication & Worker Tablet PIN
    print("\n[Stage 2] Verifying Auth, Token Minting & Tablet PIN Login...")
    status, auth_res = request("POST", "/auth/pin-login", {
        "userId": "usr-santosh",
        "pin": "9901"
    })
    assert_true(status == 200 and auth_res.get("success"), "Worker PIN login succeeds")
    token = auth_res.get("token")
    assert_true(bool(token), "Bearer token issued successfully")

    status, me_res = request("GET", "/auth/me", token=token)
    assert_true(status == 200 and "Santosh" in me_res["user"]["user_name"], "Token verification retrieves worker profile")

    # 3. CRM & Native Order Intake (Zoho Replacement)
    print("\n[Stage 3] Native CRM Inquiry & Order Creation with Size Matrix...")
    status, inq_res = request("POST", "/crm/inquiries", {
        "clientName": "Apex Frontier Apparel",
        "contactPerson": "Vikram Seth",
        "phone": "9819283746",
        "email": "vikram@apexapparel.in",
        "category": "Apparel",
        "subCategory": "Polo",
        "productName": "Matty Pique Premium Polo",
        "targetQty": 300,
        "targetBudgetPerPc": 380.0
    }, token=token)
    assert_true(status == 200 and inq_res.get("success"), "CRM inquiry created")
    inquiry_no = inq_res["data"]["inquiryNo"]

    status, ord_res = request("POST", "/crm/orders/create", {
        "clientName": "Apex Frontier Apparel",
        "contactPerson": "Vikram Seth",
        "phone": "9819283746",
        "productName": "Matty Pique Premium Polo",
        "colorName": "Airforce Navy Blue",
        "targetEtd": "2026-10-28",
        "sizeMatrix": {"S": 50, "M": 100, "L": 100, "XL": 50},
        "inquiryId": inquiry_no
    }, token=token)
    if status != 200:
        print(f"Error creating order: status={status}, body={ord_res}")
    assert_true(status == 200 and ord_res.get("success"), "Production order booked with size breakdown matrix")
    order_no = ord_res["data"]["productionOrderNo"]
    print(f"  Created Order: {order_no} (Total: {ord_res['data']['totalQty']} pcs)")

    # 4. Automated BOM Explosion & Procurement Shortfall
    print("\n[Stage 4] Automated BOM Explosion, Shortfall Analysis & PO Generation...")
    status, bom_res = request("POST", f"/bom/orders/{order_no}/allocate", {
        "autoCreateShortfallPO": True
    }, token=token)
    if status != 200:
        print(f"Error allocating BOM: status={status}, body={bom_res}")
    assert_true(status == 200 and bom_res.get("success"), "BOM exploded and stock allocated")
    allocations = bom_res["data"]["allocations"]
    assert_true(len(allocations) >= 5, "BOM allocated fabric, collars, cuffs, buttons, and labels")
    auto_po_no = bom_res["data"]["shortfallPurchaseOrderNo"]
    print(f"  Shortfalls detected -> Automated Sourcing PO generated: {auto_po_no}")

    status, po_appr = request("POST", f"/purchasing/orders/{auto_po_no}/approve", {}, token=token)
    if status != 200:
        print(f"Error approving PO: status={status}, body={po_appr}")
    assert_true(status == 200 and po_appr.get("success"), "Purchase order executive approval")

    # 5. Inventory & Lot Inwarding (Dual UOM, Roll Remnant)
    print("\n[Stage 5] Inwarding Fabric Lot with Industrial Sequences (DDMMYY-A-01/N)...")
    status, next_code_res = request("GET", "/inventory/next-parent-code")
    suggested_parent = next_code_res["suggestedCode"]

    status, inw_res = request("POST", "/inventory/inward", {
        "parentCode": suggested_parent,
        "vendorId": "ent-tirupur",
        "invoiceNo": "INV-MILL-8891",
        "vendorFabName": "220 GSM Matty Pique",
        "vendorColor": "Airforce Navy Blue",
        "noOfBundles": 2,
        "invoiceQty": 80.0,
        "inwardPhysicalQty": 79.5,
        "rate": 340.0,
        "bundles": [
            {"weight": 39.5, "locationBin": "BIN-A-01", "gsm": 220, "width": "60\""},
            {"weight": 40.0, "locationBin": "BIN-A-02", "gsm": 220, "width": "60\""}
        ]
    }, token=token)
    if status != 200:
        print(f"Error inwarding lot: status={status}, body={inw_res}")
    assert_true(status == 200 and inw_res.get("success"), "Parent lot inwarded with child rolls")
    roll_code_1 = inw_res["data"]["items"][0]["bundleCode"]
    print(f"  Created Roll: {roll_code_1}")

    # Dual UOM Test
    status, uom_res = request("POST", "/inventory/dual-uom", {
        "weightKg": 40.0,
        "widthInches": 60,
        "gsm": 220
    })
    assert_true(status == 200 and uom_res["data"]["computedLengthMeters"] > 0, "Dual UOM calculates length from roll weight")

    # Issue Roll to Cutting
    status, iss_res = request("POST", "/inventory/issue", {
        "materialType": "Fabric",
        "itemCode": roll_code_1,
        "productionOrderNo": order_no,
        "qty": 35.0
    }, token=token)
    assert_true(status == 200 and iss_res.get("success"), "Fabric roll issued to production order")

    # 6. Cutting Lay Telemetry with Master Palla Measurement
    print("\n[Stage 6] Cutting Lay Telemetry & Palla Yield Calculation...")
    status, cut_res = request("POST", "/operations/cutting/lay", {
        "productionOrderNo": order_no,
        "bundleCode": roll_code_1,
        "cutterId": "usr-santosh",
        "layNo": 1,
        "samplePallaPcs": 6,
        "samplePallaWeightKg": 1.320,  # 0.220 kg per piece palla average
        "totalFabricWeightUsedKg": 33.0,
        "sizeBreakdown": {"S": 25, "M": 50, "L": 50, "XL": 25},
        "targetBomConsumption": 0.220
    }, token=token)
    if status != 200:
        print(f"Error recording cutting lay: status={status}, body={cut_res}")
    assert_true(status == 200 and cut_res.get("success"), "Cutting lay recorded with palla telemetry")
    assert_true(cut_res["data"]["pallaAverageKg"] == 0.22, "Palla average accurately computed (1.320 / 6 = 0.220 kg)")
    print(f"  Cut Job: {cut_res['data']['cutJobNo']} ({cut_res['data']['totalPcsCut']} pcs cut, variance: {cut_res['data']['variancePct']}%)")

    # Return remnant roll from cutting
    status, rem_res = request("POST", "/inventory/return-remnant", {
        "bundleCode": roll_code_1,
        "returnedWeightKg": 2.0,
        "productionOrderNo": order_no
    }, token=token)
    assert_true(status == 200 and rem_res.get("success"), "Unused fabric returned as remnant roll to warehouse")

    # 7. Runner Chain-of-Custody & Discrepancy Detection
    print("\n[Stage 7] Runner Chain-of-Custody & Strict Discrepancy Detection...")
    status, trn_res = request("POST", "/operations/transits/dispatch", {
        "productionOrderNo": order_no,
        "sourceStation": "Cutting Floor",
        "destStation": "Branding Subcontractor",
        "runnerId": "usr-ramesh",
        "itemType": "Cut_Panels",
        "itemRef": cut_res["data"]["cutJobNo"],
        "dispatchedQty": 150
    }, token=token)
    if status != 200:
        print(f"Error dispatching transit: status={status}, body={trn_res}")
    assert_true(status == 200 and trn_res.get("success"), "Transit pass generated for runner")
    transit_pass_no = trn_res["data"]["transitPassNo"]

    # Runner acknowledges pickup
    status, pku_res = request("POST", "/operations/transits/pickup", {
        "transitPassNo": transit_pass_no,
        "runnerId": "usr-ramesh"
    }, token=token)
    assert_true(status == 200 and pku_res["data"]["status"] == "IN_TRANSIT", "Runner pickup verified -> IN_TRANSIT")

    # Receiver finds missing piece -> Discrepancy Flagged
    status, rec_res = request("POST", "/operations/transits/receive", {
        "transitPassNo": transit_pass_no,
        "receivedQty": 148, # 2 missing
        "receivedBy": "usr-suresh",
        "discrepancyReason": "Bundle bundle-tie snapped during motorbike transport"
    }, token=token)
    assert_true(status == 200 and rec_res["data"]["status"] == "DISCREPANCY_FLAGGED", "Discrepancy flagged on piece mismatch")
    print(f"  Handover Discrepancy captured: {rec_res['data']['variance']} pcs missing (Reason logged)")

    # 8. Subcontractor Delivery Challans, Debit Notes & Remakes
    print("\n[Stage 8] Subcontractor Challan, Rejections, Debit Note & Remake Work Order...")
    status, ch_res = request("POST", "/operations/challans/dispatch", {
        "productionOrderNo": order_no,
        "vendorId": "ent-tirupur",
        "processType": "Branding",
        "brandingType": "Screen_Print",
        "panelName": "Front Chest Logo",
        "qtySent": 148,
        "expectedEta": "2026-10-18"
    }, token=token)
    assert_true(status == 200 and ch_res.get("success"), "Subcontractor delivery challan dispatched")
    challan_no = ch_res["data"]["challanNo"]

    # Receive from vendor with defective prints
    status, ch_rec = request("POST", "/operations/challans/receive", {
        "challanNo": challan_no,
        "qtyReceived": 136,
        "rejectionQty": 12, # Severe vendor defect
        "rejectionReason": "Ink bleed and registration offset on white logo"
    }, token=token)
    assert_true(status == 200 and ch_rec.get("success"), "Subcontractor panels received with logged defect")

    # Check automated debit note and remake work order
    status, dn_res = request("GET", f"/operations/subcontractors/debit-notes?vendorId=ent-tirupur")
    assert_true(status == 200 and len(dn_res["data"]) > 0, "Automated debit note generated for damaged panels")
    print(f"  Debit Note created for vendor: ₹{dn_res['data'][0]['total_debit_amount']}")

    status, rmk_res = request("GET", "/operations/remakes")
    assert_true(status == 200 and len(rmk_res["data"]) > 0, "Automated Remake Work Order queued for cutting")
    print(f"  Remake Order queued: {rmk_res['data'][0]['remake_order_no']} for {rmk_res['data'][0]['total_pcs_to_remake']} pcs")

    # 9. Floor Process Telemetry & 100% QC Pareto
    print("\n[Stage 9] Floor Stitching, 100% QC Telemetry & Defect Pareto...")
    status, st_res = request("POST", "/operations/process-logs", {
        "productionOrderNo": order_no,
        "processName": "Stitching",
        "operatorId": "usr-dilip",
        "stationCode": "LINE-A",
        "completedQty": 130,
        "rejectedQty": 2,
        "reworkQty": 4,
        "defectCategory": "BROKEN_STITCH",
        "sizeBreakdown": {"S": 20, "M": 45, "L": 45, "XL": 20}
    }, token=token)
    assert_true(status == 200 and st_res.get("success"), "Stitching telemetry recorded")

    status, qc_res = request("POST", "/operations/process-logs", {
        "productionOrderNo": order_no,
        "processName": "QC_Inspection",
        "operatorId": "usr-santosh",
        "stationCode": "QC-FINAL",
        "completedQty": 128,
        "rejectedQty": 2,
        "defectCategory": "PUCKERING"
    }, token=token)
    assert_true(status == 200 and qc_res.get("success"), "100% Quality Check telemetry recorded")

    status, pareto_res = request("GET", f"/operations/defects/pareto?orderNo={order_no}")
    assert_true(status == 200 and len(pareto_res["data"]) > 0, "Defect Pareto analysis generated")

    # 10. Carton Packing Manifest & Over-Pack Prevention
    print("\n[Stage 10] Carton Packing Manifest & Strict Over-Pack Prevention...")
    status, pack_res = request("POST", "/operations/cartons/pack", {
        "productionOrderNo": order_no,
        "boxType": "7-Ply Heavy Master Box",
        "grossWeightKg": 14.5,
        "sizeBreakdown": {"S": 20, "M": 40, "L": 40, "XL": 20},
        "packedBy": "usr-dilip"
    }, token=token)
    assert_true(status == 200 and pack_res.get("success"), "Master carton sealed with size breakdown")
    carton_no = pack_res["data"]["cartonNo"]
    print(f"  Carton Sealed: {carton_no} ({pack_res['data']['totalPcs']} pcs)")

    # Test over-pack prevention
    status, over_res = request("POST", "/operations/cartons/pack", {
        "productionOrderNo": order_no,
        "sizeBreakdown": {"S": 999} # Way above cut limit
    }, token=token)
    assert_true(status == 400 and not over_res.get("success"), "Over-pack prevention successfully rejected excess count")

    # Packing Manifest
    status, mani_res = request("GET", f"/operations/cartons/manifest/{order_no}")
    assert_true(status == 200 and mani_res["data"]["totalPieces"] == 120, "Packing manifest sums box contents accurately")

    # 11. Costing, Indian GST Invoice, Payment Receipts & OCR Post-Mortem
    print("\n[Stage 11] Costing Simulator, Tax Invoice, Payments & Order Completion Report...")
    status, cost_res = request("POST", "/finance/costing/calculate", {
        "fabricRatePerKg": 340.0,
        "fabricAvgKgPerPc": 0.220,
        "sellingPrice": 380.0
    })
    assert_true(status == 200 and cost_res["data"]["targetMrp"] > 0, "4x MRP Simulator calculates pricing and Indian GST")

    status, inv_res = request("POST", "/finance/invoices/generate", {
        "productionOrderNo": order_no,
        "unitPrice": 380.0,
        "freightAmount": 850.0
    }, token=token)
    assert_true(status == 200 and inv_res.get("success"), "Statutory tax invoice generated")
    invoice_no = inv_res["data"]["invoiceNo"]
    print(f"  Tax Invoice: {invoice_no} (Total: ₹{inv_res['data']['totalAmount']})")

    # Record client payment with UTR
    status, pay_res = request("POST", "/finance/payments/record", {
        "invoiceId": invoice_no,
        "amount": inv_res["data"]["totalAmount"],
        "paymentMode": "NEFT_RTGS",
        "referenceNo": "HDFC-UTR-991823719"
    }, token=token)
    assert_true(status == 200 and pay_res["data"]["status"] == "Paid", "Payment receipt recorded & invoice marked Paid")

    # Order Completion Report (OCR)
    status, ocr_res = request("POST", f"/finance/orders/{order_no}/ocr", {}, token=token)
    if status != 200:
        print(f"Error generating OCR: status={status}, body={ocr_res}")
    assert_true(status == 200 and ocr_res.get("success"), "Order Completion Report (OCR) post-mortem generated")
    print(f"  OCR Report: {ocr_res['data']['ocrNo']} - Realized Gross Profit: ₹{ocr_res['data']['grossRealizedProfit']} ({ocr_res['data']['realizedProfitPct']}%)")

    # 12. 2-Way WhatsApp ChatOps Engine
    print("\n[Stage 12] 2-Way Interactive WhatsApp ChatOps Engine...")
    status, wa_status_res = request("POST", "/whatsapp/webhook", {
        "from": "919822233445",
        "senderName": "Vikram Seth (Client)",
        "body": f"STATUS {order_no}"
    })
    assert_true(status == 200 and "FPCC LIVE ORDER PULSE" in wa_status_res["data"]["replyText"], "ChatOps 'STATUS' command returns order pulse")

    status, wa_stock_res = request("POST", "/whatsapp/webhook", {
        "from": "919822233445",
        "senderName": "Store Master",
        "body": "STOCK Matty Pique"
    })
    assert_true(status == 200 and "WAREHOUSE STOCK" in wa_stock_res["data"]["replyText"], "ChatOps 'STOCK' command returns active roll balances")

    status, wa_logs_res = request("GET", "/whatsapp/logs?limit=5")
    assert_true(status == 200 and len(wa_logs_res["data"]) >= 2, "WhatsApp communication log tracks all interactions")

    print("\n" + "=" * 60)
    print("🏆 ALL 12 ENTERPRISE MODULES VERIFIED & 100% OPERATIONAL!")
    print("=" * 60)

if __name__ == "__main__":
    main()
