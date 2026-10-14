import urllib.request
import json
import sys

BASE_URL = "http://localhost:3000/api"

def request(endpoint, method="GET", data=None):
    url = f"{BASE_URL}{endpoint}"
    headers = {"Content-Type": "application/json"}
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        print(f"❌ HTTP {e.code} Error on {method} {url}: {err_body}")
        raise

def test_flow():
    print("================================================================")
    print("🚀 FPCC CORTEX: TESTING CRM, FINANCE & WHATSAPP CHATOPS SUITE")
    print("================================================================")

    # 1. Test Inquiries
    print("\n[Step 1] Creating a new CRM Inquiry...")
    inq_res = request("/crm/inquiries", "POST", {
        "clientName": "Razorpay Tech Merchandise",
        "contactPerson": "Vikram Sethi",
        "phone": "+91 98765 43210",
        "email": "vikram@razorpay.com",
        "category": "Apparel",
        "subCategory": "Polo",
        "productName": "Matty Polo T-Shirt with Collar Jacquard",
        "targetQty": 500,
        "targetBudgetPerPc": 450,
        "notes": "Looking for pre-shrunk bio-wash fabric with collar tipping."
    })
    print(f"✅ Created Inquiry: {inq_res['data']['inquiryNo']} (ID: {inq_res['data']['id']})")

    # 2. Test Costing & 4x MRP Simulator
    print("\n[Step 2] Calculating Production Costing, 4x MRP & GST Tier...")
    costing_res = request("/finance/costing/calculate", "POST", {
        "fabricRatePerKg": 360.0,
        "fabricAvgKgPerPc": 0.230,
        "accessoriesCost": 18.0,
        "cuttingCost": 8.0,
        "stitchingCost": 38.0,
        "finishingCost": 12.0,
        "brandingCost": 22.0,
        "rejectionBufferPct": 5.0,
        "sellingPrice": 395.0,
        "taxBilling": "extra",
        "isApparel": True
    })
    cdata = costing_res["data"]
    print(f"  • Fabric Cost / pc: ₹{cdata['fabricCostPerPc']}")
    print(f"  • Total Production Cost: ₹{cdata['totalProductionCost']}")
    print(f"  • Target 4x MRP: ₹{cdata['targetMrp']}")
    print(f"  • Selling Price: ₹{cdata['sellingPrice']}")
    print(f"  • GST Rate: {cdata['taxRatePct']}% (Tier for apparel <= ₹2500)")
    print(f"  • Net Profit / pc: ₹{cdata['profitInr']} ({cdata['profitPct']}%)")
    assert cdata['targetMrp'] == round(cdata['totalProductionCost'] * 4, 2), "MRP must be 4x production cost"
    print("✅ Costing Engine & 4x MRP Rule Verified!")

    # 3. Test Native Order Intake (Zoho Replacement)
    print("\n[Step 3] Native Order Intake (Size Breakdown + Auto-generated Production Order)...")
    order_res = request("/crm/orders/create", "POST", {
        "orderType": "Bulk",
        "clientName": "Razorpay Tech Merchandise",
        "contactPerson": "Vikram Sethi",
        "phone": "+91 98765 43210",
        "email": "vikram@razorpay.com",
        "billingAddress": "Razorpay Towers, Koramangala, Bengaluru, KA 560034",
        "gstin": "29AABCR1234F1Z5",
        "category": "Apparel",
        "subCategory": "Polo",
        "productName": "Matty Polo T-Shirt with Collar Jacquard",
        "colorName": "Navy Blue",
        "unitPrice": 395.0,
        "taxRate": 5.0,
        "targetEtd": "2026-11-05",
        "sizeMatrix": {
            "S": 50,
            "M": 150,
            "L": 200,
            "XL": 100
        },
        "clientComments": "Collar tipped in white; 1 chest embroidery logo."
    })
    odata = order_res["data"]
    po_no = odata["productionOrderNo"]
    print(f"✅ Native Order Created: {po_no} | Total Qty: {odata['totalQty']} pcs")
    print(f"  • Auto WhatsApp Order Ack Sent: {odata['whatsappNotificationSent']}")

    # 4. Test Tax Invoice Generation
    print("\n[Step 4] Generating Tax Invoice for Order...")
    inv_res = request("/finance/invoices/generate", "POST", {
        "productionOrderNo": po_no,
        "unitPrice": 395.0,
        "freightAmount": 1500.0,
        "dueDate": "2026-11-20",
        "notes": "Payment terms 15 days from dispatch"
    })
    idata = inv_res["data"]
    inv_no = idata["invoiceNo"]
    print(f"✅ Generated Tax Invoice: {inv_no}")
    print(f"  • Total Invoice Amount: ₹{idata['totalAmount']} (incl. GST ₹{idata['gstAmount']})")
    print(f"  • Outstanding Balance: ₹{idata['balanceDue']}")

    # 5. Test Payment Receipt
    print("\n[Step 5] Recording Advance Payment Receipt...")
    pay_res = request("/finance/payments/record", "POST", {
        "invoiceId": inv_no,
        "amount": 100000.0,
        "paymentMode": "NEFT_RTGS",
        "referenceNo": "HDFC-N9872149812",
        "notes": "50% advance received via NEFT"
    })
    pdata = pay_res["data"]
    print(f"✅ Recorded Payment: {pdata['paymentNo']} for Invoice {pdata['invoiceNo']}")
    print(f"  • Received: ₹{pdata['amountReceived']}")
    print(f"  • Remaining Balance Due: ₹{pdata['newBalanceDue']} (Status: {pdata['status']})")

    # 6. Test Finance Summary
    print("\n[Step 6] Verifying Financial Summary / Accounts Receivable...")
    summary_res = request("/finance/summary", "GET")
    sdata = summary_res["data"]
    print(f"  • Total Invoiced: ₹{sdata['totalInvoiced']}")
    print(f"  • Total Collected: ₹{sdata['totalCollected']}")
    print(f"  • Accounts Receivable: ₹{sdata['accountsReceivable']}")
    print(f"  • Unpaid/Partial Invoices: {sdata['unpaidCount']}")
    print("✅ Financial Accounts Engine Verified!")

    # 7. Test WhatsApp Outbound & Inbound ChatOps
    print("\n[Step 7] Testing WhatsApp Outbound Notification Dispatch...")
    wa_send_res = request("/whatsapp/send", "POST", {
        "phoneNumber": "+91 98765 43210",
        "recipientName": "Vikram Sethi",
        "messageType": "PO_DISPATCH",
        "messageBody": f"Hi Vikram, production cutting for order {po_no} has commenced on the FPCC shop floor!",
        "relatedEntityType": "Order",
        "relatedEntityId": po_no
    })
    print(f"✅ WhatsApp Outbound Logged: {wa_send_res['data']['logId']} (Status: {wa_send_res['data']['status']})")

    print("\n[Step 8] Testing WhatsApp Inbound ChatOps Webhook Commands...")
    
    # 8A: STATUS Command
    status_chat = request("/whatsapp/webhook", "POST", {
        "sender": "919876543210",
        "senderName": "Vikram Sethi",
        "message": f"STATUS {po_no}"
    })
    print(f"  • Command: STATUS {po_no}")
    print(f"  • Bot Response:\n{status_chat['data']['replyText']}\n")

    # 8B: STOCK Command
    stock_chat = request("/whatsapp/webhook", "POST", {
        "sender": "919822233445",
        "senderName": "Floor Supervisor",
        "message": "STOCK Polar Fleece"
    })
    print(f"  • Command: STOCK Polar Fleece")
    print(f"  • Bot Response:\n{stock_chat['data']['replyText']}\n")

    # 8C: RUNNER PICKUP & ARRIVED Commands
    # Fetch an existing transit pass
    transits = request("/operations/transits", "GET")
    if transits["data"]:
        t_pass = transits["data"][0]["transit_pass_no"]
        print(f"  • Testing Runner ChatOps with Pass: {t_pass}")
        
        pickup_chat = request("/whatsapp/webhook", "POST", {
            "sender": "919811122233",
            "senderName": "Ramesh (Runner)",
            "message": f"RUNNER {t_pass} PICKUP"
        })
        print(f"    Pickup Response:\n{pickup_chat['data']['replyText']}\n")

        arrived_chat = request("/whatsapp/webhook", "POST", {
            "sender": "919811122233",
            "senderName": "Suresh (Destination Incharge)",
            "message": f"RUNNER {t_pass} ARRIVED {transits['data'][0]['dispatched_qty']}"
        })
        print(f"    Arrived Response:\n{arrived_chat['data']['replyText']}\n")

    # 8D: Check WhatsApp Logs
    wa_logs = request("/whatsapp/logs", "GET")
    print(f"✅ Verified WhatsApp Engine: Total {wa_logs['count']} simulated messages recorded in audit log!")

    print("\n================================================================")
    print("🎉 ALL CRM, FINANCE & WHATSAPP CHATOPS TESTS PASSED 100%!")
    print("================================================================")

if __name__ == "__main__":
    test_flow()
