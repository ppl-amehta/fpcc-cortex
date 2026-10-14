/**
 * FPCC Cortex: Catalog of Pre-Built Industrial & Executive Reports
 * Out-of-the-box analytical reports demonstrating multi-hop graph traversal
 * across material provenance, floor operations, logistics, quality, and finances.
 */

const PREBUILT_REPORTS = {
  cutting_yield_palla_variance: {
    key: 'cutting_yield_palla_variance',
    title: 'Cutting Table Efficiency & Palla Yield Variance',
    category: 'Cutting & Material Operations',
    description: 'Analyzes actual fabric consumption per garment vs budgeted BOM across cutting masters, fabric rolls, and supplying yarn mills.',
    query: {
      baseEntity: 'cutting_jobs',
      fields: [
        'cutting_jobs.cut_job_no',
        'order.production_order_no',
        'order.client_name',
        'cutter.user_name',
        'bundle.bundle_code',
        'bundle.fabric_name',
        'bundle.color_name',
        'bundle.parent_lot.parent_code',
        'bundle.parent_lot.vendor.name',
        'cutting_jobs.total_pcs_cut',
        'cutting_jobs.calculated_palla_avg_kg',
        'cutting_jobs.actual_consumption_per_pc',
        'cutting_jobs.target_bom_consumption',
        'cutting_jobs.variance_pct'
      ],
      orderBy: [
        { field: 'cutting_jobs.created_at', direction: 'DESC' }
      ],
      limit: 50
    }
  },

  subcontractor_quality_and_debit_recovery: {
    key: 'subcontractor_quality_and_debit_recovery',
    title: 'Subcontractor Defect Pareto & Debit Recovery',
    category: 'Subcontracting & Quality',
    description: 'Tracks panels sent to external job-workers, rejections, defect categorizations, and automated debit notes issued for fabric damage.',
    query: {
      baseEntity: 'challans',
      fields: [
        'challans.challan_no',
        'order.production_order_no',
        'vendor.name',
        'challans.branding_type',
        'challans.panel_name',
        'challans.qty_sent',
        'challans.qty_received',
        'challans.rejection_qty',
        'challans.rejection_reason',
        'challans.status'
      ],
      orderBy: [
        { field: 'challans.rejection_qty', direction: 'DESC' }
      ],
      limit: 50
    }
  },

  runner_custody_loss_hotspots: {
    key: 'runner_custody_loss_hotspots',
    title: 'Runner Custody Logistics & Transit Discrepancies',
    category: 'Logistics & Chain of Custody',
    description: 'Monitors internal transit passes between floor stations, identifying piece count variances and missing panel hotspots.',
    query: {
      baseEntity: 'transits',
      fields: [
        'transits.transit_pass_no',
        'order.production_order_no',
        'runner.user_name',
        'transits.source_station',
        'transits.dest_station',
        'transits.item_type',
        'transits.dispatched_qty',
        'transits.received_qty',
        'transits.variance_qty',
        'transits.transit_status',
        'transits.discrepancy_reason'
      ],
      orderBy: [
        { field: 'transits.dispatched_at', direction: 'DESC' }
      ],
      limit: 50
    }
  },

  floor_qc_defect_pareto: {
    key: 'floor_qc_defect_pareto',
    title: '100% Floor QC Inspection & Defect Pareto Analysis',
    category: 'Shop Floor & Quality',
    description: 'Detailed defect breakdown across stitching and finishing operations grouped by defect category and machine operator.',
    query: {
      baseEntity: 'floor_logs',
      fields: [
        'floor_logs.production_order_no',
        'operator.user_name',
        'floor_logs.process_name',
        'floor_logs.station_code',
        'floor_logs.completed_qty',
        'floor_logs.rejected_qty',
        'floor_logs.rework_qty',
        'floor_logs.defect_category'
      ],
      orderBy: [
        { field: 'floor_logs.created_at', direction: 'DESC' }
      ],
      limit: 50
    }
  },

  carton_fulfillment_manifest: {
    key: 'carton_fulfillment_manifest',
    title: 'Carton Packing & Shipment Fulfillment Manifest',
    category: 'Packing & Dispatch',
    description: 'Master carton dispatch tracking with gross weight telemetry, sealed box breakdown, and client order matching.',
    query: {
      baseEntity: 'cartons',
      fields: [
        'cartons.carton_no',
        'order.production_order_no',
        'order.client_name',
        'order.product_name',
        'packer.user_name',
        'cartons.gross_weight_kg',
        'cartons.total_pcs',
        'cartons.status'
      ],
      orderBy: [
        { field: 'cartons.created_at', direction: 'DESC' }
      ],
      limit: 50
    }
  },

  client_receivables_and_cashflow: {
    key: 'client_receivables_and_cashflow',
    title: 'Client Invoicing & Accounts Receivable Aging',
    category: 'Finance & Cash Flow',
    description: 'Real-time receivables ledger tracking billed GST invoices, payments received with UTRs, and outstanding credit balances.',
    query: {
      baseEntity: 'invoices',
      fields: [
        'invoices.invoice_no',
        'client.name',
        'order.production_order_no',
        'invoices.invoice_date',
        'invoices.subtotal_amount',
        'invoices.gst_amount',
        'invoices.total_amount',
        'invoices.amount_paid',
        'invoices.balance_due',
        'invoices.payment_status'
      ],
      orderBy: [
        { field: 'invoices.balance_due', direction: 'DESC' }
      ],
      limit: 50
    }
  },

  order_360_post_mortem: {
    key: 'order_360_post_mortem',
    title: 'Order 360 Post-Mortem & Margin Realization',
    category: 'Executive Intelligence',
    description: 'Complete post-dispatch audit comparing planned fabric vs actual consumption, scrap weight, and quoted vs realized OCR profit margins.',
    query: {
      baseEntity: 'ocr',
      fields: [
        'ocr.ocr_no',
        'order.production_order_no',
        'order.client_name',
        'order.product_name',
        'ocr.total_planned_pcs',
        'ocr.total_cut_pcs',
        'ocr.total_packed_pcs',
        'ocr.fabric_scrap_kg',
        'ocr.fabric_efficiency_pct',
        'ocr.total_invoice_value_inr',
        'ocr.gross_realized_profit_inr',
        'ocr.realized_profit_pct',
        'ocr.quoted_profit_pct',
        'ocr.margin_variance_pct',
        'ocr.closure_status'
      ],
      orderBy: [
        { field: 'ocr.created_at', direction: 'DESC' }
      ],
      limit: 50
    }
  },

  dye_lot_lineage_traceability: {
    key: 'dye_lot_lineage_traceability',
    title: 'Dye Lot Traceability & Roll Lineage',
    category: 'Traceability & Raw Materials',
    description: 'Full raw material pedigree tracing active fabric rolls back to their parent dye lot, inward invoice, and yarn mill vendor.',
    query: {
      baseEntity: 'bundles',
      fields: [
        'bundles.bundle_code',
        'parent_lot.parent_code',
        'parent_lot.vendor.name',
        'parent_lot.invoice_no',
        'bundles.fabric_name',
        'bundles.color_name',
        'bundles.bundle_gsm',
        'bundles.original_qty',
        'bundles.available_qty',
        'bundles.location_bin',
        'bundles.qc_status'
      ],
      orderBy: [
        { field: 'bundles.created_at', direction: 'DESC' }
      ],
      limit: 50
    }
  }
};

module.exports = {
  PREBUILT_REPORTS
};
