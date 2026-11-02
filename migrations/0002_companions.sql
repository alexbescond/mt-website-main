-- Preserve existing orders and their photo keys and add the companion choice independently.
ALTER TABLE orders ADD COLUMN companion_type TEXT NOT NULL DEFAULT 'tetine' CHECK (companion_type IN ('tetine','doudou'));
ALTER TABLE orders ADD COLUMN companion_name TEXT NOT NULL DEFAULT '';
