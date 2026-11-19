import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { normalizeEthiopianPhone } from '../utils/phone.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'teraye_temp_secret_2026';

function signUserToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      assigned_station_id: user.assigned_station_id || null,
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// 1. Check current session
router.get('/me', requireAuth, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.json({ registered: false, telegramUser: req.telegramUser || null });
    }
    const [rows] = await pool.query(
      'SELECT id, full_name, phone_number, role, assigned_station_id, telegram_id FROM teraye_users WHERE id = ? AND is_active = 1 LIMIT 1',
      [req.user.id]
    );
    if (!rows[0]) {
      return res.json({ registered: false, telegramUser: req.telegramUser || null });
    }
    return res.json({ registered: true, user: rows[0] });
  } catch (err) {
    console.error('GET /auth/me error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 2. Temporary Dev Bypass Session (active only when DEV_BYPASS_AUTH=true)
router.get('/dev-session', async (req, res) => {
  if (process.env.DEV_BYPASS_AUTH !== 'true') {
    return res.status(403).json({ error: 'Dev bypass is disabled.' });
  }
  try {
    const [rows] = await pool.query(
      "SELECT id, full_name, phone_number, role, assigned_station_id, telegram_id FROM teraye_users WHERE role IN ('ADMIN', 'WORKER') AND is_active = 1 LIMIT 1"
    );
    const user = rows[0] || {
      id: '00000000-0000-0000-0000-000000000001',
      full_name: 'Dev Admin',
      phone_number: '+251921319216',
      role: 'ADMIN',
      assigned_station_id: 1,
    };
    const token = signUserToken(user);
    return res.json({ token, user });
  } catch (err) {
    console.error('GET /auth/dev-session error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 3. Mobile / Web Browser Phone + PIN Login
router.post(['/mobile/login', '/login'], async (req, res) => {
  try {
    const rawPhone = req.body.phoneNumber || req.body.phone;
    const { pin } = req.body;
    const { candidates } = normalizeEthiopianPhone(rawPhone);

    if (!candidates.length || !pin) {
      return res.status(400).json({ error: 'Phone number and PIN are required.' });
    }

    const [rows] = await pool.query(
      'SELECT * FROM teraye_users WHERE phone_number IN (?, ?) AND is_active = 1 LIMIT 1',
      [candidates[0], candidates[1] || candidates[0]]
    );

    const user = rows[0];
    if (!user || !user.pin_hash) {
      return res.status(401).json({ error: 'Invalid phone number or PIN.' });
    }

    const validPin = await bcrypt.compare(String(pin).trim(), user.pin_hash);
    if (!validPin) {
      return res.status(401).json({ error: 'Invalid phone number or PIN.' });
    }

    const token = signUserToken(user);
    return res.json({
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        phone_number: user.phone_number,
        role: user.role,
        assigned_station_id: user.assigned_station_id,
      },
    });
  } catch (err) {
    console.error('POST /auth/mobile/login error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 4. Request 6-digit PIN Reset OTP via Telegram
router.post('/forgot-pin', async (req, res) => {
  try {
    const rawPhone = req.body.phoneNumber || req.body.phone;
    const { candidates } = normalizeEthiopianPhone(rawPhone);

    if (!candidates.length) {
      return res.status(400).json({ error: 'Enter a valid Ethiopian phone number.' });
    }

    const [rows] = await pool.query(
      'SELECT id, full_name, telegram_id FROM teraye_users WHERE phone_number IN (?, ?) AND is_active = 1 LIMIT 1',
      [candidates[0], candidates[1] || candidates[0]]
    );

    const user = rows[0];
    if (!user) {
      return res.status(404).json({ error: 'No active account found with that phone number.' });
    }
    if (!user.telegram_id) {
      return res.status(400).json({
        error: 'No Telegram account linked. Open the Teraye Telegram bot first or contact an Admin.',
      });
    }

    const otp = String(crypto.randomInt(100000, 999999));
    const otpHash = await bcrypt.hash(otp, 10);

    await pool.query(
      'UPDATE teraye_users SET reset_otp_hash = ?, reset_otp_expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE id = ?',
      [otpHash, user.id]
    );

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: user.telegram_id,
        text: `🔐 *Teraye (ተራየ) PIN Reset*\n\nHello ${user.full_name || 'User'}, your verification code is:\n\n\`${otp}\`\n\nExpires in 10 minutes.`,
        parse_mode: 'Markdown',
      }),
    });

    if (!tgRes.ok) {
      return res.status(502).json({ error: 'Could not send Telegram code. Start the bot first.' });
    }

    return res.json({ ok: true, message: '6-digit verification code sent to your Telegram.' });
  } catch (err) {
    console.error('POST /auth/forgot-pin error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 5. Verify Telegram OTP and Save New 4-6 Digit PIN
router.post('/reset-pin', async (req, res) => {
  try {
    const rawPhone = req.body.phoneNumber || req.body.phone;
    const { otp, newPin } = req.body;
    const { candidates } = normalizeEthiopianPhone(rawPhone);

    if (!candidates.length || !otp || !/^\d{4,6}$/.test(String(newPin).trim())) {
      return res.status(400).json({ error: 'Phone, 6-digit code, and 4–6 digit new PIN are required.' });
    }

    const [rows] = await pool.query(
      'SELECT id, reset_otp_hash, reset_otp_expires_at FROM teraye_users WHERE phone_number IN (?, ?) AND is_active = 1 LIMIT 1',
      [candidates[0], candidates[1] || candidates[0]]
    );

    const user = rows[0];
    if (!user || !user.reset_otp_hash || !user.reset_otp_expires_at) {
      return res.status(400).json({ error: 'No active reset request. Request a new code.' });
    }
    if (new Date(user.reset_otp_expires_at) < new Date()) {
      return res.status(400).json({ error: 'Code expired. Request a new code.' });
    }

    const validOtp = await bcrypt.compare(String(otp).trim(), user.reset_otp_hash);
    if (!validOtp) {
      return res.status(401).json({ error: 'Incorrect verification code.' });
    }

    const newPinHash = await bcrypt.hash(String(newPin).trim(), 10);
    await pool.query(
      'UPDATE teraye_users SET pin_hash = ?, reset_otp_hash = NULL, reset_otp_expires_at = NULL WHERE id = ?',
      [newPinHash, user.id]
    );

    return res.json({ ok: true, message: 'PIN updated! Sign in with your new PIN.' });
  } catch (err) {
    console.error('POST /auth/reset-pin error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;