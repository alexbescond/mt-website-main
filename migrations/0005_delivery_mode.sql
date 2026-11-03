-- Existing orders keep weekly delivery. send_interval_days remains the weekly interval.
-- grouped orders use delivery_mode to schedule and dispatch every card together.
ALTER TABLE orders ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'weekly'
  CHECK (delivery_mode IN ('weekly','together'));
