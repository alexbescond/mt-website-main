-- Keep the existing positive amount as the pre-coupon subtotal. Renaming the
-- column avoids rebuilding orders and cascading deletion of tracking data.
ALTER TABLE orders RENAME COLUMN amount_cents TO subtotal_cents;
ALTER TABLE orders ADD COLUMN amount_cents INTEGER NOT NULL DEFAULT 0 CHECK(amount_cents >= 0);
UPDATE orders SET amount_cents = subtotal_cents;
ALTER TABLE orders ADD COLUMN coupon_id TEXT;
ALTER TABLE orders ADD COLUMN coupon_label TEXT;
ALTER TABLE orders ADD COLUMN coupon_percent_off INTEGER NOT NULL DEFAULT 0 CHECK(coupon_percent_off BETWEEN 0 AND 100);
ALTER TABLE orders ADD COLUMN coupon_discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(coupon_discount_cents >= 0);
ALTER TABLE orders ADD COLUMN coupon_first_order INTEGER NOT NULL DEFAULT 0 CHECK(coupon_first_order IN (0,1));

CREATE TABLE coupons (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  percent_off INTEGER NOT NULL CHECK(percent_off BETWEEN 1 AND 100),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  first_order_only INTEGER NOT NULL DEFAULT 0 CHECK(first_order_only IN (0,1)),
  allowed_email_hash TEXT,
  starts_at INTEGER,
  expires_at INTEGER,
  max_redemptions INTEGER CHECK(max_redemptions > 0),
  CHECK(starts_at IS NULL OR expires_at IS NULL OR expires_at > starts_at)
);
-- Codes are normalized to uppercase, emails to lowercase, then SHA-256 hashed.
-- Neither the private code nor its permitted email needs to be shipped to browsers.
INSERT INTO coupons(id,code_hash,label,percent_off,first_order_only) VALUES
  ('welcome10','22b0493861832fff303c27eb48a8c1436174fb13675ced0361a01ae698154379','Bienvenue',10,1);
INSERT INTO coupons(id,code_hash,label,percent_off,allowed_email_hash) VALUES
  ('personal-free','f5b06708cd8f41f6f0b045a736b85c34b27b0091dd10c09eebe59d6b22c4a2e9','Offre personnelle',100,'87145cf969632d44eeea21b9f40b548b75bf1e10a8e9e62d30ce7776c0a7c3cb');

CREATE INDEX orders_coupon_usage ON orders(coupon_id,payment_mode,status);
CREATE INDEX orders_customer_history ON orders(lower(trim(email)),payment_mode,status);
CREATE UNIQUE INDEX orders_first_order_offer ON orders(lower(trim(email)),payment_mode)
  WHERE coupon_first_order=1 AND status IN ('pending','paid');
