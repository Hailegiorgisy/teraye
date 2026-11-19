-- Safe idempotent migration for fresh MySQL / MariaDB setups.
-- Skip if reset_otp_hash and reset_otp_expires_at already exist in your live DB.
ALTER TABLE teraye_users
  ADD COLUMN IF NOT EXISTS reset_otp_hash VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS reset_otp_expires_at DATETIME NULL;
