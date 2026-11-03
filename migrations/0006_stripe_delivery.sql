-- Existing orders keep their validated address and separate name fields.
-- New orders collect a full recipient name and delivery details in Stripe.
ALTER TABLE orders ADD COLUMN recipient_name TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'ready'
  CHECK(delivery_status IN ('pending','ready','needs_review'));
