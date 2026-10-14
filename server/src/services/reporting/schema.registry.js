/**
 * FPCC Cortex: Semantic Graph Schema Registry
 * Inspired by Rippling's Unified Employee & Company Graph Architecture.
 *
 * Defines first-class Entity Nodes, Attributes, and Traversable Relationship Edges
 * across the entire garment manufacturing, inventory, logistics, floor, and financial lifecycle.
 */

const ENTITIES = {
  orders: {
    tableName: 'production_orders',
    primaryKey: 'id',
    businessKey: 'production_order_no',
    displayName: 'Production Orders',
    description: 'Central manufacturing order node tracking planned, cut, stitched, QC, and packed progress.',
    fields: {
      id: { type: 'string', displayName: 'Order ID' },
      production_order_no: { type: 'string', displayName: 'Order Number', filterable: true },
      sales_order_no: { type: 'string', displayName: 'Sales Order No', filterable: true },
      order_type: { type: 'enum', displayName: 'Order Type', filterable: true, options: ['Bulk', 'Sample', 'FOC', 'Development'] },
      client_id: { type: 'string', displayName: 'Client ID', filterable: true },
      client_name: { type: 'string', displayName: 'Client Name', filterable: true },
      product_name: { type: 'string', displayName: 'Product Name', filterable: true },
      color_name: { type: 'string', displayName: 'Color', filterable: true },
      total_qty: { type: 'number', displayName: 'Target Quantity (pcs)', aggregatable: ['sum', 'avg', 'min', 'max'] },
      target_etd: { type: 'date', displayName: 'Target Delivery Date', filterable: true },
      status: { type: 'enum', displayName: 'Order Status', filterable: true, options: ['Planning', 'Material_Allocated', 'Cutting', 'Branding', 'Stitching', 'Finishing', 'Packed', 'Dispatched', 'Completed'] },
      created_at: { type: 'datetime', displayName: 'Created At' }
    },
    relationships: {
      client: {
        targetEntity: 'entities',
        type: 'belongsTo',
        localKey: 'client_id',
        targetKey: 'id',
        displayName: 'Customer Client'
      },
      cutting_jobs: {
        targetEntity: 'cutting_jobs',
        type: 'hasMany',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Cutting Lays & Palla Telemetry'
      },
      transits: {
        targetEntity: 'transits',
        type: 'hasMany',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Runner Logistics & Chain of Custody'
      },
      challans: {
        targetEntity: 'challans',
        type: 'hasMany',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Subcontractor Delivery Challans'
      },
      floor_logs: {
        targetEntity: 'floor_logs',
        type: 'hasMany',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Floor Process & 100% QC Telemetry'
      },
      cartons: {
        targetEntity: 'cartons',
        type: 'hasMany',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Sealed Master Cartons'
      },
      invoices: {
        targetEntity: 'invoices',
        type: 'hasMany',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Sales Tax Invoices'
      },
      debit_notes: {
        targetEntity: 'debit_notes',
        type: 'hasMany',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Subcontractor Debit Notes'
      },
      remakes: {
        targetEntity: 'remakes',
        type: 'hasMany',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Remake Work Orders'
      },
      ocr: {
        targetEntity: 'ocr',
        type: 'hasOne',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Order Completion Report (OCR)'
      },
      bom_allocations: {
        targetEntity: 'bom_allocations',
        type: 'hasMany',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Material Allocations'
      },
      purchase_orders: {
        targetEntity: 'purchase_orders',
        type: 'hasMany',
        localKey: 'production_order_no',
        targetKey: 'related_production_order_no',
        displayName: 'Sourcing Purchase Orders'
      }
    }
  },

  cutting_jobs: {
    tableName: 'cutting_jobs',
    primaryKey: 'id',
    businessKey: 'cut_job_no',
    displayName: 'Cutting Lays & Palla Telemetry',
    description: 'Lay telemetry capturing sample palla averages, actual consumption, and yield variance against BOM.',
    fields: {
      id: { type: 'string', displayName: 'Cut Job ID' },
      cut_job_no: { type: 'string', displayName: 'Cut Job No', filterable: true },
      production_order_no: { type: 'string', displayName: 'Order Number', filterable: true },
      bundle_code: { type: 'string', displayName: 'Fabric Roll Code', filterable: true },
      cutter_id: { type: 'string', displayName: 'Cutter ID', filterable: true },
      lay_no: { type: 'number', displayName: 'Lay Number' },
      lay_length_meters: { type: 'number', displayName: 'Lay Length (m)' },
      plies_count: { type: 'number', displayName: 'Plies Count' },
      sample_palla_pcs: { type: 'number', displayName: 'Sample Palla Pcs' },
      sample_palla_weight_kg: { type: 'number', displayName: 'Sample Palla Wt (kg)' },
      calculated_palla_avg_kg: { type: 'number', displayName: 'Palla Avg (kg/pc)', aggregatable: ['avg', 'min', 'max'] },
      total_fabric_weight_used_kg: { type: 'number', displayName: 'Fabric Weight Used (kg)', aggregatable: ['sum', 'avg'] },
      total_pcs_cut: { type: 'number', displayName: 'Total Pieces Cut', aggregatable: ['sum', 'avg'] },
      actual_consumption_per_pc: { type: 'number', displayName: 'Actual Consumption (kg/pc)', aggregatable: ['avg', 'min', 'max'] },
      target_bom_consumption: { type: 'number', displayName: 'Target BOM Consumption (kg/pc)' },
      variance_pct: { type: 'percent', displayName: 'Yield Variance %', aggregatable: ['avg', 'min', 'max'] },
      remarks: { type: 'string', displayName: 'Remarks' },
      created_at: { type: 'datetime', displayName: 'Cut Date & Time' }
    },
    relationships: {
      order: {
        targetEntity: 'orders',
        type: 'belongsTo',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Production Order'
      },
      bundle: {
        targetEntity: 'bundles',
        type: 'belongsTo',
        localKey: 'bundle_code',
        targetKey: 'bundle_code',
        displayName: 'Fabric Roll / Bundle'
      },
      cutter: {
        targetEntity: 'users',
        type: 'belongsTo',
        localKey: 'cutter_id',
        targetKey: 'id',
        displayName: 'Cutting Master'
      }
    }
  },

  bundles: {
    tableName: 'fabric_bundles',
    primaryKey: 'id',
    businessKey: 'bundle_code',
    displayName: 'Fabric Rolls & Bundles',
    description: 'Individual physical roll with fractional sequence (01/N), net weight, GSM, width, and bin location.',
    fields: {
      id: { type: 'string', displayName: 'Bundle ID' },
      bundle_code: { type: 'string', displayName: 'Roll Code', filterable: true },
      parent_lot_id: { type: 'string', displayName: 'Parent Lot ID', filterable: true },
      parent_code: { type: 'string', displayName: 'Dye Lot Parent Code', filterable: true },
      bundle_sequence: { type: 'number', displayName: 'Roll Sequence' },
      total_bundles: { type: 'number', displayName: 'Total Rolls in Lot' },
      fabric_name: { type: 'string', displayName: 'Fabric Type', filterable: true },
      color_name: { type: 'string', displayName: 'Color', filterable: true },
      bundle_gsm: { type: 'number', displayName: 'Measured GSM' },
      bundle_width: { type: 'number', displayName: 'Measured Width (in)' },
      original_qty: { type: 'number', displayName: 'Inward Weight (kg)', aggregatable: ['sum', 'avg'] },
      available_qty: { type: 'number', displayName: 'Available Weight (kg)', aggregatable: ['sum', 'avg'] },
      issued_qty: { type: 'number', displayName: 'Issued Weight (kg)', aggregatable: ['sum', 'avg'] },
      location_bin: { type: 'string', displayName: 'Warehouse Bin', filterable: true },
      qc_status: { type: 'enum', displayName: 'QC Status', filterable: true, options: ['PENDING', 'PASSED', 'REJECTED'] },
      created_at: { type: 'datetime', displayName: 'Inward Timestamp' }
    },
    relationships: {
      parent_lot: {
        targetEntity: 'parent_lots',
        type: 'belongsTo',
        localKey: 'parent_lot_id',
        targetKey: 'id',
        displayName: 'Parent Dye Lot'
      },
      qc_inspector: {
        targetEntity: 'users',
        type: 'belongsTo',
        localKey: 'qc_done_by',
        targetKey: 'id',
        displayName: 'QC Inspector'
      },
      cutting_jobs: {
        targetEntity: 'cutting_jobs',
        type: 'hasMany',
        localKey: 'bundle_code',
        targetKey: 'bundle_code',
        displayName: 'Cutting Lays Using This Roll'
      }
    }
  },

  parent_lots: {
    tableName: 'parent_inward_lots',
    primaryKey: 'id',
    businessKey: 'parent_code',
    displayName: 'Parent Dye Lots',
    description: 'Multi-component dye lot parent grouping body fabric, collar, cuff, and rib to guarantee shade consistency.',
    fields: {
      id: { type: 'string', displayName: 'Lot ID' },
      parent_code: { type: 'string', displayName: 'Dye Lot Code (DDMMYY-A)', filterable: true },
      inward_date: { type: 'date', displayName: 'Inward Date', filterable: true },
      vendor_id: { type: 'string', displayName: 'Vendor ID', filterable: true },
      invoice_no: { type: 'string', displayName: 'Vendor Invoice No', filterable: true },
      inward_type: { type: 'enum', displayName: 'Material Type', filterable: true, options: ['Fabric', 'Collar', 'Cuff', 'Rib', 'Zip', 'Label', 'Trims', 'Packaging'] },
      vendor_fab_name: { type: 'string', displayName: 'Vendor Fabric Description' },
      vendor_color: { type: 'string', displayName: 'Vendor Shade Name' },
      no_of_bundles: { type: 'number', displayName: 'Number of Rolls/Bundles' },
      uom: { type: 'string', displayName: 'Unit of Measure' },
      invoice_qty: { type: 'number', displayName: 'Billed Quantity', aggregatable: ['sum', 'avg'] },
      inward_physical_qty: { type: 'number', displayName: 'Physical Inward Qty', aggregatable: ['sum', 'avg'] },
      shortfall_qty: { type: 'number', displayName: 'Inward Shortfall Qty', aggregatable: ['sum', 'avg'] },
      rate: { type: 'currency', displayName: 'Rate per Unit (₹)', aggregatable: ['avg', 'min', 'max'] },
      remarks: { type: 'string', displayName: 'Remarks' },
      created_at: { type: 'datetime', displayName: 'Inwarded At' }
    },
    relationships: {
      vendor: {
        targetEntity: 'entities',
        type: 'belongsTo',
        localKey: 'vendor_id',
        targetKey: 'id',
        displayName: 'Yarn/Knitting Vendor'
      },
      receiver: {
        targetEntity: 'users',
        type: 'belongsTo',
        localKey: 'created_by',
        targetKey: 'id',
        displayName: 'Inward Stores Clerk'
      },
      bundles: {
        targetEntity: 'bundles',
        type: 'hasMany',
        localKey: 'id',
        targetKey: 'parent_lot_id',
        displayName: 'Rolls in Lot'
      }
    }
  },

  entities: {
    tableName: 'entities',
    primaryKey: 'id',
    businessKey: 'name',
    displayName: 'Business Entities (Clients, Vendors, Subcontractors)',
    description: 'Master record for external business partners: corporate customers, fabric mills, and job-workers.',
    fields: {
      id: { type: 'string', displayName: 'Entity ID' },
      name: { type: 'string', displayName: 'Company Name', filterable: true },
      entity_type: { type: 'enum', displayName: 'Entity Type', filterable: true, options: ['client', 'vendor', 'both'] },
      contact_person: { type: 'string', displayName: 'Contact Person' },
      phone: { type: 'string', displayName: 'Phone Number', filterable: true },
      email: { type: 'string', displayName: 'Email Address' },
      gstin: { type: 'string', displayName: 'GSTIN Number', filterable: true },
      address: { type: 'string', displayName: 'Factory/Office Address' },
      created_at: { type: 'datetime', displayName: 'Registered Date' }
    },
    relationships: {
      orders: {
        targetEntity: 'orders',
        type: 'hasMany',
        localKey: 'id',
        targetKey: 'client_id',
        displayName: 'Client Orders'
      },
      lots: {
        targetEntity: 'parent_lots',
        type: 'hasMany',
        localKey: 'id',
        targetKey: 'vendor_id',
        displayName: 'Fabric Lots Supplied'
      },
      challans: {
        targetEntity: 'challans',
        type: 'hasMany',
        localKey: 'id',
        targetKey: 'vendor_id',
        displayName: 'Job-Work Challans'
      },
      debit_notes: {
        targetEntity: 'debit_notes',
        type: 'hasMany',
        localKey: 'id',
        targetKey: 'vendor_id',
        displayName: 'Debit Notes Issued'
      },
      invoices: {
        targetEntity: 'invoices',
        type: 'hasMany',
        localKey: 'id',
        targetKey: 'client_id',
        displayName: 'Client Tax Invoices'
      },
      payments: {
        targetEntity: 'payments',
        type: 'hasMany',
        localKey: 'id',
        targetKey: 'client_id',
        displayName: 'Payment Receipts'
      }
    }
  },

  transits: {
    tableName: 'material_transits',
    primaryKey: 'id',
    businessKey: 'transit_pass_no',
    displayName: 'Runner Logistics & Chain of Custody',
    description: 'Internal transit pass ensuring end-to-end chain of custody with exact physical piece verification.',
    fields: {
      id: { type: 'string', displayName: 'Transit ID' },
      transit_pass_no: { type: 'string', displayName: 'Transit Pass No', filterable: true },
      production_order_no: { type: 'string', displayName: 'Order Number', filterable: true },
      source_station: { type: 'enum', displayName: 'Source Station', filterable: true, options: ['Warehouse', 'Cutting', 'Branding', 'Stitching', 'Finishing', 'QC', 'Packing', 'Dispatch'] },
      dest_station: { type: 'enum', displayName: 'Destination Station', filterable: true, options: ['Warehouse', 'Cutting', 'Branding', 'Stitching', 'Finishing', 'QC', 'Packing', 'Dispatch'] },
      runner_id: { type: 'string', displayName: 'Runner ID', filterable: true },
      item_type: { type: 'string', displayName: 'Item Type', filterable: true },
      item_ref: { type: 'string', displayName: 'Item Reference Code' },
      dispatched_qty: { type: 'number', displayName: 'Dispatched Quantity (pcs)', aggregatable: ['sum', 'avg'] },
      received_qty: { type: 'number', displayName: 'Received Quantity (pcs)', aggregatable: ['sum', 'avg'] },
      transit_status: { type: 'enum', displayName: 'Transit Status', filterable: true, options: ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED_VERIFIED', 'DISCREPANCY_FLAGGED'] },
      variance_qty: { type: 'number', displayName: 'Discrepancy Variance (pcs)', aggregatable: ['sum', 'avg', 'max'] },
      discrepancy_reason: { type: 'string', displayName: 'Discrepancy Reason' },
      notes: { type: 'string', displayName: 'Transit Notes' },
      dispatched_at: { type: 'datetime', displayName: 'Dispatched At' },
      received_at: { type: 'datetime', displayName: 'Received At' }
    },
    relationships: {
      order: {
        targetEntity: 'orders',
        type: 'belongsTo',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Production Order'
      },
      runner: {
        targetEntity: 'users',
        type: 'belongsTo',
        localKey: 'runner_id',
        targetKey: 'id',
        displayName: 'Runner'
      },
      dispatcher: {
        targetEntity: 'users',
        type: 'belongsTo',
        localKey: 'dispatched_by',
        targetKey: 'id',
        displayName: 'Dispatch Station Head'
      },
      receiver: {
        targetEntity: 'users',
        type: 'belongsTo',
        localKey: 'received_by',
        targetKey: 'id',
        displayName: 'Receiving Station Head'
      }
    }
  },

  challans: {
    tableName: 'subcontractor_challans',
    primaryKey: 'id',
    businessKey: 'challan_no',
    displayName: 'Subcontractor Delivery Challans',
    description: 'Statutory GST delivery challan sent to external embellishment and job-work units with defect tracking.',
    fields: {
      id: { type: 'string', displayName: 'Challan ID' },
      challan_no: { type: 'string', displayName: 'Challan Number', filterable: true },
      production_order_no: { type: 'string', displayName: 'Order Number', filterable: true },
      vendor_id: { type: 'string', displayName: 'Vendor ID', filterable: true },
      process_type: { type: 'string', displayName: 'Process Type', filterable: true },
      branding_type: { type: 'enum', displayName: 'Branding Type', filterable: true, options: ['Screen_Print', 'Embroidery', 'DTF', 'Heatseal'] },
      panel_name: { type: 'string', displayName: 'Panel / Placement', filterable: true },
      qty_sent: { type: 'number', displayName: 'Quantity Sent', aggregatable: ['sum', 'avg'] },
      qty_received: { type: 'number', displayName: 'Quantity Received', aggregatable: ['sum', 'avg'] },
      rejection_qty: { type: 'number', displayName: 'Defective Rejections', aggregatable: ['sum', 'avg'] },
      rework_qty: { type: 'number', displayName: 'Rework Quantity', aggregatable: ['sum', 'avg'] },
      rejection_reason: { type: 'string', displayName: 'Defect Reason', filterable: true },
      defect_photo_url: { type: 'string', displayName: 'Defect Evidence Photo' },
      status: { type: 'enum', displayName: 'Challan Status', filterable: true, options: ['Dispatched', 'At_Vendor', 'Partially_Received', 'Completed', 'Rework_Pending'] },
      date_sent: { type: 'datetime', displayName: 'Date Sent' },
      expected_eta: { type: 'date', displayName: 'Expected Return Date' },
      actual_received_date: { type: 'datetime', displayName: 'Actual Received Date' }
    },
    relationships: {
      order: {
        targetEntity: 'orders',
        type: 'belongsTo',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Production Order'
      },
      vendor: {
        targetEntity: 'entities',
        type: 'belongsTo',
        localKey: 'vendor_id',
        targetKey: 'id',
        displayName: 'Subcontractor Vendor'
      },
      debit_notes: {
        targetEntity: 'debit_notes',
        type: 'hasMany',
        localKey: 'challan_no',
        targetKey: 'challan_no',
        displayName: 'Debit Notes Issued for Spoilage'
      }
    }
  },

  debit_notes: {
    tableName: 'debit_notes',
    primaryKey: 'id',
    businessKey: 'debit_note_no',
    displayName: 'Vendor Debit Notes',
    description: 'Financial penalty debit notes billed to subcontractors for damaged panels and printing rejects.',
    fields: {
      id: { type: 'string', displayName: 'Debit Note ID' },
      debit_note_no: { type: 'string', displayName: 'Debit Note No', filterable: true },
      vendor_id: { type: 'string', displayName: 'Vendor ID', filterable: true },
      vendor_name: { type: 'string', displayName: 'Vendor Name', filterable: true },
      challan_no: { type: 'string', displayName: 'Challan No', filterable: true },
      production_order_no: { type: 'string', displayName: 'Order Number', filterable: true },
      rejected_qty: { type: 'number', displayName: 'Damaged Pieces', aggregatable: ['sum', 'avg'] },
      panel_cost_per_pc: { type: 'currency', displayName: 'Material + Cutting Invested (₹)' },
      total_debit_amount: { type: 'currency', displayName: 'Total Debit Amount (₹)', aggregatable: ['sum', 'avg'] },
      reason: { type: 'string', displayName: 'Defect Reason', filterable: true },
      status: { type: 'enum', displayName: 'Debit Note Status', filterable: true, options: ['Issued', 'Accepted_By_Vendor', 'Settled_In_Billing', 'Disputed'] },
      created_at: { type: 'datetime', displayName: 'Issued At' }
    },
    relationships: {
      challan: {
        targetEntity: 'challans',
        type: 'belongsTo',
        localKey: 'challan_no',
        targetKey: 'challan_no',
        displayName: 'Delivery Challan'
      },
      order: {
        targetEntity: 'orders',
        type: 'belongsTo',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Production Order'
      },
      vendor: {
        targetEntity: 'entities',
        type: 'belongsTo',
        localKey: 'vendor_id',
        targetKey: 'id',
        displayName: 'Vendor'
      }
    }
  },

  floor_logs: {
    tableName: 'floor_process_logs',
    primaryKey: 'id',
    displayName: 'Floor Process & 100% QC Telemetry',
    description: 'Granular process logs covering Stitching, Buttoning, Ironing, and 100% Quality Inspection.',
    fields: {
      id: { type: 'string', displayName: 'Log ID' },
      production_order_no: { type: 'string', displayName: 'Order Number', filterable: true },
      process_name: { type: 'enum', displayName: 'Process Operation', filterable: true, options: ['Stitching', 'Thread_Cutting', 'Kaaj', 'Button', 'Eyelet', 'Bartack', 'Heatseal', 'Ironing', 'QC_Inspection'] },
      operator_id: { type: 'string', displayName: 'Operator ID', filterable: true },
      station_code: { type: 'string', displayName: 'Workstation Line', filterable: true },
      completed_qty: { type: 'number', displayName: 'Good Completed Pcs', aggregatable: ['sum', 'avg'] },
      rejected_qty: { type: 'number', displayName: 'Defect Rejections', aggregatable: ['sum', 'avg'] },
      rework_qty: { type: 'number', displayName: 'Rework Count', aggregatable: ['sum', 'avg'] },
      defect_category: { type: 'string', displayName: 'Defect Category', filterable: true },
      created_at: { type: 'datetime', displayName: 'Logged Timestamp' }
    },
    relationships: {
      order: {
        targetEntity: 'orders',
        type: 'belongsTo',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Production Order'
      },
      operator: {
        targetEntity: 'users',
        type: 'belongsTo',
        localKey: 'operator_id',
        targetKey: 'id',
        displayName: 'Floor Operator'
      }
    }
  },

  cartons: {
    tableName: 'carton_packings',
    primaryKey: 'id',
    businessKey: 'carton_no',
    displayName: 'Carton Packing Manifests',
    description: 'Master carton packing records with gross weight telemetry and strict over-pack prevention.',
    fields: {
      id: { type: 'string', displayName: 'Carton ID' },
      carton_no: { type: 'string', displayName: 'Carton Number', filterable: true },
      production_order_no: { type: 'string', displayName: 'Order Number', filterable: true },
      box_type: { type: 'string', displayName: 'Box Packaging Type' },
      gross_weight_kg: { type: 'number', displayName: 'Gross Weight (kg)', aggregatable: ['sum', 'avg'] },
      total_pcs: { type: 'number', displayName: 'Total Pieces in Carton', aggregatable: ['sum', 'avg'] },
      packed_by: { type: 'string', displayName: 'Packer User ID', filterable: true },
      status: { type: 'enum', displayName: 'Carton Status', filterable: true, options: ['Open', 'Sealed', 'In_Transit_Dispatch', 'Dispatched'] },
      destination_address: { type: 'string', displayName: 'Shipping Destination' },
      created_at: { type: 'datetime', displayName: 'Packed At' }
    },
    relationships: {
      order: {
        targetEntity: 'orders',
        type: 'belongsTo',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Production Order'
      },
      packer: {
        targetEntity: 'users',
        type: 'belongsTo',
        localKey: 'packed_by',
        targetKey: 'id',
        displayName: 'Packing Clerk'
      }
    }
  },

  invoices: {
    tableName: 'invoices',
    primaryKey: 'id',
    businessKey: 'invoice_no',
    displayName: 'Sales Tax Invoices',
    description: 'Statutory GST tax invoices issued to clients with dynamic tax calculation and balance tracking.',
    fields: {
      id: { type: 'string', displayName: 'Invoice ID' },
      invoice_no: { type: 'string', displayName: 'Invoice Number', filterable: true },
      production_order_no: { type: 'string', displayName: 'Order Number', filterable: true },
      client_id: { type: 'string', displayName: 'Client ID', filterable: true },
      client_name: { type: 'string', displayName: 'Client Name', filterable: true },
      invoice_date: { type: 'date', displayName: 'Invoice Date', filterable: true },
      subtotal_amount: { type: 'currency', displayName: 'Taxable Subtotal (₹)', aggregatable: ['sum', 'avg'] },
      gst_rate_pct: { type: 'percent', displayName: 'GST Rate %', filterable: true },
      gst_amount: { type: 'currency', displayName: 'GST Tax (₹)', aggregatable: ['sum', 'avg'] },
      total_amount: { type: 'currency', displayName: 'Grand Total (₹)', aggregatable: ['sum', 'avg'] },
      amount_paid: { type: 'currency', displayName: 'Collected (₹)', aggregatable: ['sum', 'avg'] },
      balance_due: { type: 'currency', displayName: 'Balance Due (₹)', aggregatable: ['sum', 'avg'] },
      payment_status: { type: 'enum', displayName: 'Payment Status', filterable: true, options: ['Unpaid', 'Partially_Paid', 'Paid', 'Overdue'] },
      created_at: { type: 'datetime', displayName: 'Issued Timestamp' }
    },
    relationships: {
      order: {
        targetEntity: 'orders',
        type: 'belongsTo',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Production Order'
      },
      client: {
        targetEntity: 'entities',
        type: 'belongsTo',
        localKey: 'client_id',
        targetKey: 'id',
        displayName: 'Customer Client'
      },
      payments: {
        targetEntity: 'payments',
        type: 'hasMany',
        localKey: 'id',
        targetKey: 'invoice_id',
        displayName: 'Payment Receipts'
      }
    }
  },

  payments: {
    tableName: 'payments',
    primaryKey: 'id',
    businessKey: 'payment_no',
    displayName: 'Payment Receipts',
    description: 'Bank payment receipts recording client remittances with bank UTR reconciliation.',
    fields: {
      id: { type: 'string', displayName: 'Payment ID' },
      payment_no: { type: 'string', displayName: 'Receipt Number', filterable: true },
      invoice_id: { type: 'string', displayName: 'Invoice ID', filterable: true },
      client_id: { type: 'string', displayName: 'Client ID', filterable: true },
      payment_date: { type: 'date', displayName: 'Payment Date', filterable: true },
      amount: { type: 'currency', displayName: 'Amount Received (₹)', aggregatable: ['sum', 'avg'] },
      payment_mode: { type: 'enum', displayName: 'Payment Mode', filterable: true, options: ['NEFT_RTGS', 'UPI', 'Cheque', 'Cash'] },
      reference_no: { type: 'string', displayName: 'Bank UTR / Reference' },
      created_at: { type: 'datetime', displayName: 'Recorded At' }
    },
    relationships: {
      invoice: {
        targetEntity: 'invoices',
        type: 'belongsTo',
        localKey: 'invoice_id',
        targetKey: 'id',
        displayName: 'Sales Invoice'
      },
      client: {
        targetEntity: 'entities',
        type: 'belongsTo',
        localKey: 'client_id',
        targetKey: 'id',
        displayName: 'Client'
      }
    }
  },

  ocr: {
    tableName: 'order_completion_reports',
    primaryKey: 'id',
    businessKey: 'ocr_no',
    displayName: 'Order Completion Reports (OCR)',
    description: 'Post-mortem intelligence reconciling planned vs actual fabric consumption, scrap, and realized profit margins.',
    fields: {
      id: { type: 'string', displayName: 'OCR ID' },
      ocr_no: { type: 'string', displayName: 'OCR Number', filterable: true },
      production_order_no: { type: 'string', displayName: 'Order Number', filterable: true },
      total_planned_pcs: { type: 'number', displayName: 'Planned Pcs' },
      total_cut_pcs: { type: 'number', displayName: 'Cut Pcs' },
      total_packed_pcs: { type: 'number', displayName: 'Packed Pcs' },
      surplus_overrun_pcs: { type: 'number', displayName: 'Surplus Pcs' },
      planned_fabric_kg: { type: 'number', displayName: 'Planned Fabric (kg)' },
      net_fabric_consumed_kg: { type: 'number', displayName: 'Net Fabric Consumed (kg)' },
      fabric_scrap_kg: { type: 'number', displayName: 'Scrap Fabric (kg)', aggregatable: ['sum', 'avg'] },
      planned_fabric_avg_kg_per_pc: { type: 'number', displayName: 'Planned BOM Avg (kg)' },
      actual_fabric_avg_kg_per_pc: { type: 'number', displayName: 'Realized Fabric Avg (kg)' },
      fabric_efficiency_pct: { type: 'percent', displayName: 'Fabric Efficiency %', aggregatable: ['avg', 'min', 'max'] },
      total_invoice_value_inr: { type: 'currency', displayName: 'Revenue Invoiced (₹)', aggregatable: ['sum', 'avg'] },
      net_actual_production_cost_inr: { type: 'currency', displayName: 'Actual Production Cost (₹)', aggregatable: ['sum', 'avg'] },
      gross_realized_profit_inr: { type: 'currency', displayName: 'Realized Gross Profit (₹)', aggregatable: ['sum', 'avg'] },
      realized_profit_pct: { type: 'percent', displayName: 'Realized Margin %', aggregatable: ['avg', 'min', 'max'] },
      quoted_profit_pct: { type: 'percent', displayName: 'Quoted Margin %' },
      margin_variance_pct: { type: 'percent', displayName: 'Margin Variance %', aggregatable: ['avg', 'min', 'max'] },
      closure_status: { type: 'enum', displayName: 'Closure Status', filterable: true, options: ['COMPLETED', 'SURPLUS_STOCKED', 'INVESTIGATION_REQUIRED'] },
      created_at: { type: 'datetime', displayName: 'Completed At' }
    },
    relationships: {
      order: {
        targetEntity: 'orders',
        type: 'belongsTo',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Production Order'
      }
    }
  },

  remakes: {
    tableName: 'remake_work_orders',
    primaryKey: 'id',
    businessKey: 'remake_order_no',
    displayName: 'Remake Work Orders',
    description: 'Automated remediation work orders issued to replace rejected panels while strictly preserving dye lot match.',
    fields: {
      id: { type: 'string', displayName: 'Remake Order ID' },
      remake_order_no: { type: 'string', displayName: 'Remake Order No', filterable: true },
      production_order_no: { type: 'string', displayName: 'Order Number', filterable: true },
      source_incident: { type: 'enum', displayName: 'Source Incident', filterable: true, options: ['Subcontractor_Rejection', 'QC_Inspection_Fail', 'Transit_Loss', 'Cutting_Defect'] },
      parent_dye_lot_id: { type: 'string', displayName: 'Matching Dye Lot Code', filterable: true },
      fabric_name: { type: 'string', displayName: 'Fabric Name' },
      color_name: { type: 'string', displayName: 'Color' },
      total_pcs_to_remake: { type: 'number', displayName: 'Remake Pieces', aggregatable: ['sum', 'avg'] },
      estimated_fabric_kg: { type: 'number', displayName: 'Estimated Fabric (kg)', aggregatable: ['sum', 'avg'] },
      priority: { type: 'enum', displayName: 'Priority', filterable: true, options: ['NORMAL', 'HIGH', 'CRITICAL'] },
      status: { type: 'enum', displayName: 'Remake Status', filterable: true, options: ['Queued', 'Fabric_Issued', 'Cut_Complete', 'Branded', 'Stitched', 'Closed'] }
    },
    relationships: {
      order: {
        targetEntity: 'orders',
        type: 'belongsTo',
        localKey: 'production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Production Order'
      },
      cutter: {
        targetEntity: 'users',
        type: 'belongsTo',
        localKey: 'assigned_cutter_id',
        targetKey: 'id',
        displayName: 'Assigned Cutter'
      }
    }
  },

  users: {
    tableName: 'users',
    primaryKey: 'id',
    businessKey: 'user_name',
    displayName: 'Factory Workers & Staff',
    description: 'Factory operators, cutting masters, runners, store keepers, and line supervisors.',
    fields: {
      id: { type: 'string', displayName: 'User ID' },
      user_name: { type: 'string', displayName: 'Worker Name', filterable: true },
      role: { type: 'enum', displayName: 'Role', filterable: true, options: ['SuperAdmin', 'Admin', 'Stores', 'Merchandiser', 'Packing Store', 'Cutter', 'Runner', 'Operator'] },
      active: { type: 'boolean', displayName: 'Active Status' }
    },
    relationships: {
      cutting_jobs: {
        targetEntity: 'cutting_jobs',
        type: 'hasMany',
        localKey: 'id',
        targetKey: 'cutter_id',
        displayName: 'Cutting Lays Managed'
      },
      transits_run: {
        targetEntity: 'transits',
        type: 'hasMany',
        localKey: 'id',
        targetKey: 'runner_id',
        displayName: 'Runner Material Transits'
      },
      floor_operations: {
        targetEntity: 'floor_logs',
        type: 'hasMany',
        localKey: 'id',
        targetKey: 'operator_id',
        displayName: 'Floor Process Output'
      },
      cartons_packed: {
        targetEntity: 'cartons',
        type: 'hasMany',
        localKey: 'id',
        targetKey: 'packed_by',
        displayName: 'Cartons Packed'
      }
    }
  },

  purchase_orders: {
    tableName: 'purchase_orders',
    primaryKey: 'id',
    businessKey: 'purchase_order_no',
    displayName: 'Sourcing Purchase Orders',
    description: 'Procurement orders issued to fabric mills and trims suppliers for BOM shortfall fulfillment.',
    fields: {
      id: { type: 'string', displayName: 'PO ID' },
      purchase_order_no: { type: 'string', displayName: 'Purchase Order No', filterable: true },
      vendor_id: { type: 'string', displayName: 'Vendor ID', filterable: true },
      vendor_name: { type: 'string', displayName: 'Vendor Name', filterable: true },
      related_production_order_no: { type: 'string', displayName: 'Related Production Order', filterable: true },
      po_date: { type: 'date', displayName: 'PO Date', filterable: true },
      total_amount: { type: 'currency', displayName: 'Total Amount (₹)', aggregatable: ['sum', 'avg'] },
      status: { type: 'enum', displayName: 'Status', filterable: true, options: ['Draft', 'Sent_To_Vendor', 'Acknowledged', 'Partially_Received', 'Completed', 'Cancelled'] }
    },
    relationships: {
      vendor: {
        targetEntity: 'entities',
        type: 'belongsTo',
        localKey: 'vendor_id',
        targetKey: 'id',
        displayName: 'Supplier Vendor'
      },
      order: {
        targetEntity: 'orders',
        type: 'belongsTo',
        localKey: 'related_production_order_no',
        targetKey: 'production_order_no',
        displayName: 'Production Order'
      }
    }
  }
};

/**
 * Graph Traversal: Find shortest relational path between two entity nodes in the graph
 * using Breadth-First Search (BFS).
 */
function findPath(startEntity, targetEntity) {
  if (startEntity === targetEntity) return [];
  if (!ENTITIES[startEntity] || !ENTITIES[targetEntity]) return null;

  const queue = [{ entity: startEntity, path: [] }];
  const visited = new Set([startEntity]);

  while (queue.length > 0) {
    const { entity, path } = queue.shift();
    const entityDef = ENTITIES[entity];

    for (const [relName, rel] of Object.entries(entityDef.relationships || {})) {
      const neighbor = rel.targetEntity;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        const newPath = [
          ...path,
          {
            sourceEntity: entity,
            relationshipName: relName,
            targetEntity: neighbor,
            type: rel.type,
            localKey: rel.localKey,
            targetKey: rel.targetKey,
            displayName: rel.displayName
          }
        ];

        if (neighbor === targetEntity) {
          return newPath;
        }

        queue.push({ entity: neighbor, path: newPath });
      }
    }
  }

  return null; // No path found
}

/**
 * Returns a complete overview of the Semantic Graph Ontology for frontend builders
 */
function getGraphSchemaOverview() {
  const summary = {};
  for (const [key, ent] of Object.entries(ENTITIES)) {
    summary[key] = {
      name: key,
      tableName: ent.tableName,
      displayName: ent.displayName,
      description: ent.description,
      fields: Object.entries(ent.fields).map(([fname, fdef]) => ({
        name: fname,
        displayName: fdef.displayName,
        type: fdef.type,
        aggregatable: fdef.aggregatable || [],
        filterable: !!fdef.filterable,
        options: fdef.options || null
      })),
      relationships: Object.entries(ent.relationships).map(([rname, rdef]) => ({
        name: rname,
        targetEntity: rdef.targetEntity,
        type: rdef.type,
        displayName: rdef.displayName
      }))
    };
  }
  return summary;
}

module.exports = {
  ENTITIES,
  findPath,
  getGraphSchemaOverview
};
