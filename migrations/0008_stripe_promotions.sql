-- Preserve existing prices and pending sessions from the previous integration.
-- New orders explicitly select Stripe as the source of promotion rules.
ALTER TABLE orders ADD COLUMN discount_source TEXT NOT NULL DEFAULT 'legacy' CHECK(discount_source IN ('legacy','stripe'));
ALTER TABLE orders ADD COLUMN stripe_promotion_code_id TEXT;
ALTER TABLE orders ADD COLUMN stripe_promotion_code TEXT;
ALTER TABLE orders ADD COLUMN stripe_coupon_id TEXT;

-- Historical rules remain for audit only. New promotions live in Stripe.
UPDATE coupons SET enabled=0;
