-- Run this in Plesk -> Databases -> phpMyAdmin to verify/reset your Admin login (0921319216 / PIN 1234)
-- 1. Check existing users and phone format:
SELECT id, full_name, phone, role, telegram_id, pin_hash FROM teraye_users;

-- 2. If your row is missing or has a different phone/PIN hash, insert or update it cleanly:
-- (Make sure backend/src/routes/auth.js normalizes 0921319216 <-> +251921319216, or store the exact format your backend checks)
