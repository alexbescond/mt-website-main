ALTER TABLE orders ADD COLUMN locale TEXT NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr','en','de','es'));
ALTER TABLE orders ADD COLUMN card_locale TEXT NOT NULL DEFAULT 'fr' CHECK (card_locale IN ('fr','en','de','es'));
