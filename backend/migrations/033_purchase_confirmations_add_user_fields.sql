ALTER TABLE purchase_confirmations ADD COLUMN IF NOT EXISTS user_departments JSON;
ALTER TABLE purchase_confirmations ADD COLUMN IF NOT EXISTS user_confirmations JSON;
