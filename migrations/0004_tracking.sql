CREATE TABLE order_cards (
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 5),
  adventure TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','preparing','ready','sent')),
  planned_date TEXT,
  sent_date TEXT,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  write_id TEXT,
  PRIMARY KEY(order_id, position),
  CHECK((state = 'sent' AND sent_date IS NOT NULL) OR (state != 'sent' AND sent_date IS NULL))
);
CREATE INDEX cards_due ON order_cards(state, planned_date);
INSERT INTO order_cards(order_id,position,adventure,updated_at)
  SELECT orders.id, CAST(j.key AS INTEGER)+1, j.value, COALESCE(paid_at,created_at)
  FROM orders, json_each(orders.card_adventures) AS j
  WHERE product_type='postcards' AND status='paid';
CREATE TABLE tracking_sessions (
  token_hash TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX tracking_expiry ON tracking_sessions(expires_at);
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('confirmation','shipped','access')),
  card_position INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL,
  lease_id TEXT,
  sent_at INTEGER,
  provider_id TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX notifications_due ON notification_outbox(status, available_at);
