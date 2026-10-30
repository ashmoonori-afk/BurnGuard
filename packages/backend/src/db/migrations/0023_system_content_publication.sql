CREATE UNIQUE INDEX uq_design_system_pending_receipt ON design_system_receipts(design_system_id)
  WHERE status IN ('prepared','recovering');
