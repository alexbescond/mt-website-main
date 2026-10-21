CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  access_token TEXT NOT NULL UNIQUE,
  book TEXT NOT NULL CHECK (book IN ('tropiques','ski')),
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
  photos_deleted_at INTEGER
);
CREATE INDEX orders_retention ON orders(status, created_at);
CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
