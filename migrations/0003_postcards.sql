-- Preserve historical book orders, payment references and private photo keys.
CREATE TABLE orders_postcards (
  id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  access_token TEXT NOT NULL UNIQUE,
  book TEXT NOT NULL,
  child_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  address TEXT NOT NULL,
  address_extra TEXT NOT NULL DEFAULT '',
  postal_code TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'FR',
  notes TEXT NOT NULL DEFAULT '',
  pacifier_key TEXT,
  child_key TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'eur',
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('test','live')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired')),
  stripe_session_id TEXT UNIQUE,
  stripe_checkout_url TEXT,
  consent_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  photos_deleted_at INTEGER,
  companion_type TEXT NOT NULL DEFAULT 'tetine' CHECK (companion_type IN ('tetine','doudou')),
  companion_name TEXT NOT NULL DEFAULT '',
  product_type TEXT NOT NULL DEFAULT 'book' CHECK (product_type IN ('book','postcards')),
  card_quantity INTEGER NOT NULL DEFAULT 1 CHECK (card_quantity BETWEEN 1 AND 5),
  unit_price_cents INTEGER,
  card_adventures TEXT NOT NULL DEFAULT '[]',
  send_interval_days INTEGER NOT NULL DEFAULT 7 CHECK (send_interval_days = 7)
);
INSERT INTO orders_postcards (id,request_hash,access_token,book,child_name,first_name,last_name,email,address,address_extra,postal_code,city,country,notes,pacifier_key,child_key,amount_cents,currency,payment_mode,status,stripe_session_id,stripe_checkout_url,consent_version,created_at,paid_at,photos_deleted_at,companion_type,companion_name) SELECT id,request_hash,access_token,book,child_name,first_name,last_name,email,address,address_extra,postal_code,city,country,notes,pacifier_key,child_key,amount_cents,currency,payment_mode,status,stripe_session_id,stripe_checkout_url,consent_version,created_at,paid_at,photos_deleted_at,companion_type,companion_name FROM orders;
DROP TABLE orders;
ALTER TABLE orders_postcards RENAME TO orders;
CREATE INDEX orders_retention ON orders(status, created_at);
