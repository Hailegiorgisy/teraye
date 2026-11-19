import crypto from 'crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, withTransaction } from '../config/db.js';
import { requireAuth, requireRegisteredUser } from '../middleware/auth.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'teraye_temp_secret_2026';

function normalizeEthPhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('251') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+251${digits.slice(1)}`;
  if ((digits.startsWith('9') || digits.startsWith('7')) && digits.length === 9) {
    return `+251${digits}`;
  }
  return null;
}

function getPhoneCandidates(raw) {
  const intl = normalizeEthPhone(raw);
  if (!intl) return [];
  const local = '0' + intl.slice(4);
  return [intl, local];
}

function normalizePlate(raw) {
  if (!raw) return null;
  return String(raw).trim().toUpperCase().replace(/\s+/g, '-');
}

function signUserToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
}

/**
 * 0. GET /api/auth/dev-session (Temporary Dev Bypass when DEV_BYPASS_AUTH=true)
 */
router.get('/dev-session', async (req, res) => {
  if (process.env.DEV_BYPASS_AUTH !== 'true') {
    return res.status(403).json({ error: 'Dev bypass is disabled.' });
  }
  try {
    const dbRes = await query(
      "SELECT id, telegram_id, phone_number, full_name, role, assigned_station_id, is_active FROM teraye_users WHERE role IN ('ADMIN', 'WORKER') AND is_active = 1 LIMIT 1"
    );
    const user = dbRes.rows[0] || {
      id: '00000000-0000-0000-0000-000000000001',
      full_name: 'Dev Admin',
      phone_number: '+251921319216',
      role: 'ADMIN',
      assigned_station_id: 1,
      is_active: 1,
    };
    const token = signUserToken(user);
    return res.json({ token, user });
  } catch (err) {
    console.error('[GET /api/auth/dev-session Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 1. GET /api/auth/me
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    if (!req.user && req.telegramUser) {
      return res.json({
        registered: false,
        telegramUser: {
          id: req.telegramUser.id,
          firstName: req.telegramUser.first_name || '',
          lastName: req.telegramUser.last_name || '',
          username: req.telegramUser.username || null,
        },
      });
    }

    let taxi = null;
    if (req.user.role === 'DRIVER') {
      const taxiRes = await query(
        `SELECT t.id, t.plate_number, t.default_route_id, t.qr_token, t.status,
                r.destination_am, r.destination_en, r.route_code
         FROM teraye_taxis t
         LEFT JOIN teraye_routes r ON r.id = t.default_route_id
         WHERE t.driver_user_id = ?
         LIMIT 1`,
        [req.user.id]
      );
      taxi = taxiRes.rows[0] || null;
    }

    return res.json({
      registered: true,
      user: req.user,
      taxi,
    });
  } catch (err) {
    console.error('[GET /api/auth/me Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 2. POST /api/auth/telegram/register
 */
router.post('/telegram/register', requireAuth, async (req, res) => {
  try {
    if (req.user) {
      return res.status(400).json({ error: 'Account is already registered.' });
    }
    if (!req.telegramUser?.id) {
      return res.status(401).json({ error: 'Telegram Mini App credentials required.' });
    }

    const phone = normalizeEthPhone(req.body.phoneNumber);
    const fullName = String(req.body.fullName || '').trim();
    const plate = normalizePlate(req.body.plateNumber);
    const defaultRouteId = req.body.defaultRouteId ? Number(req.body.defaultRouteId) : null;

    if (!phone) {
      return res.status(400).json({ error: 'Valid Ethiopian phone number (+251...) is required.' });
    }
    if (fullName.length < 2) {
      return res.status(400).json({ error: 'Full name is required.' });
    }

    const result = await withTransaction(async (client) => {
      const existingUserRes = await client.query(
        'SELECT * FROM teraye_users WHERE phone_number = ? LIMIT 1',
        [phone]
      );

      let userId;
      if (existingUserRes.rows.length > 0) {
        userId = existingUserRes.rows[0].id;
        await client.query(
          `UPDATE teraye_users
           SET telegram_id = ?, full_name = COALESCE(NULLIF(?, ''), full_name)
           WHERE id = ?`,
          [req.telegramUser.id, fullName, userId]
        );
      } else {
        userId = crypto.randomUUID();
        await client.query(
          `INSERT INTO teraye_users (id, telegram_id, phone_number, full_name, role)
           VALUES (?, ?, ?, ?, 'DRIVER')`,
          [userId, req.telegramUser.id, phone, fullName]
        );
      }

      const userRes = await client.query(
        'SELECT id, telegram_id, phone_number, full_name, role, assigned_station_id, is_active FROM teraye_users WHERE id = ? LIMIT 1',
        [userId]
      );
      const user = userRes.rows[0];

      let taxi = null;
      if (plate && user.role === 'DRIVER') {
        const taxiCheck = await client.query(
          'SELECT * FROM teraye_taxis WHERE plate_number = ? LIMIT 1',
          [plate]
        );

        if (taxiCheck.rows.length > 0) {
          const existingTaxi = taxiCheck.rows[0];
          if (existingTaxi.driver_user_id && existingTaxi.driver_user_id !== user.id) {
            throw new Error('PLATE_ALREADY_CLAIMED');
          }
          await client.query(
            `UPDATE teraye_taxis
             SET driver_user_id = ?, default_route_id = COALESCE(?, default_route_id)
             WHERE id = ?`,
            [user.id, defaultRouteId, existingTaxi.id]
          );
          const updatedTaxi = await client.query(
            'SELECT * FROM teraye_taxis WHERE id = ? LIMIT 1',
            [existingTaxi.id]
          );
          taxi = updatedTaxi.rows[0];
        } else {
          const newTaxiId = crypto.randomUUID();
          const newQrToken = crypto.randomUUID();
          await client.query(
            `INSERT INTO teraye_taxis (id, plate_number, driver_user_id, default_route_id, qr_token)
             VALUES (?, ?, ?, ?, ?)`,
            [newTaxiId, plate, user.id, defaultRouteId, newQrToken]
          );
          const createdTaxi = await client.query(
            'SELECT * FROM teraye_taxis WHERE id = ? LIMIT 1',
            [newTaxiId]
          );
          taxi = createdTaxi.rows[0];
        }
      }

      return { user, taxi };
    });

    return res.status(201).json({
      registered: true,
      user: result.user,
      taxi: result.taxi,
    });
  } catch (err) {
    if (err.message === 'PLATE_ALREADY_CLAIMED') {
      return res.status(409).json({
        error: 'This plate number is already registered to another driver. Ask a station marshal for help.',
      });
    }
    console.error('[POST /api/auth/telegram/register Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 3. POST /api/auth/mobile/login (Matches both +251... and 09/07... in MySQL)
 */
router.post('/mobile/login', async (req, res) => {
  try {
    const candidates = getPhoneCandidates(req.body.phoneNumber || req.body.phone);
    const pin = String(req.body.pin || '').trim();

    if (!candidates.length || !pin) {
      return res.status(400).json({ error: 'Valid Ethiopian phone number and PIN are required.' });
    }

    const dbRes = await query(
      'SELECT * FROM teraye_users WHERE phone_number IN (?, ?) LIMIT 1',
      [candidates[0], candidates[1]]
    );

    if (dbRes.rows.length === 0) {
      return res.status(401).json({ error: 'Account not found. Register via Telegram or ask a station marshal.' });
    }

    const user = dbRes.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is suspended.' });
    }
    if (!user.pin_hash) {
      return res.status(400).json({
        error: 'Mobile PIN not set yet. Open the Telegram Mini App first or ask a station admin to set your PIN.',
      });
    }

    const validPin = await bcrypt.compare(pin, user.pin_hash);
    if (!validPin) {
      return res.status(401).json({ error: 'Incorrect PIN.' });
    }

    const token = signUserToken(user);
    delete user.pin_hash;

    return res.json({ token, user });
  } catch (err) {
    console.error('[POST /api/auth/mobile/login Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 4. POST /api/auth/mobile/set-pin
 */
router.post('/mobile/set-pin', requireAuth, requireRegisteredUser, async (req, res) => {
  try {
    const pin = String(req.body.pin || '').trim();
    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be 4 to 6 digits.' });
    }

    const pinHash = await bcrypt.hash(pin, 10);
    await query(
      'UPDATE teraye_users SET pin_hash = ? WHERE id = ?',
      [pinHash, req.user.id]
    );

    return res.json({ success: true, message: 'Mobile App PIN saved.' });
  } catch (err) {
    console.error('[POST /api/auth/mobile/set-pin Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 5. POST /api/auth/forgot-pin (Send 6-digit OTP via Telegram)
 */
router.post('/forgot-pin', async (req, res) => {
  try {
    const candidates = getPhoneCandidates(req.body.phoneNumber || req.body.phone);
    if (!candidates.length) {
      return res.status(400).json({ error: 'Enter a valid Ethiopian phone number.' });
    }

    const dbRes = await query(
      'SELECT id, full_name, telegram_id FROM teraye_users WHERE phone_number IN (?, ?) AND is_active = 1 LIMIT 1',
      [candidates[0], candidates[1]]
    );
    const user = dbRes.rows[0];
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

    await query(
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
    console.error('[POST /api/auth/forgot-pin Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 6. POST /api/auth/reset-pin (Verify Telegram OTP & Save New PIN)
 */
router.post('/reset-pin', async (req, res) => {
  try {
    const candidates = getPhoneCandidates(req.body.phoneNumber || req.body.phone);
    const otp = String(req.body.otp || '').trim();
    const newPin = String(req.body.newPin || '').trim();

    if (!candidates.length || !/^\d{6}$/.test(otp) || !/^\d{4,6}$/.test(newPin)) {
      return res.status(400).json({ error: 'Phone, 6-digit code, and 4–6 digit new PIN are required.' });
    }

    const dbRes = await query(
      'SELECT id, reset_otp_hash, reset_otp_expires_at FROM teraye_users WHERE phone_number IN (?, ?) AND is_active = 1 LIMIT 1',
      [candidates[0], candidates[1]]
    );
    const user = dbRes.rows[0];
    if (!user || !user.reset_otp_hash || !user.reset_otp_expires_at) {
      return res.status(400).json({ error: 'No active reset request. Request a new code.' });
    }
    if (new Date(user.reset_otp_expires_at) < new Date()) {
      return res.status(400).json({ error: 'Verification code expired. Request a new code.' });
    }

    const validOtp = await bcrypt.compare(otp, user.reset_otp_hash);
    if (!validOtp) {
      return res.status(401).json({ error: 'Incorrect verification code.' });
    }

    const newPinHash = await bcrypt.hash(newPin, 10);
    await query(
      'UPDATE teraye_users SET pin_hash = ?, reset_otp_hash = NULL, reset_otp_expires_at = NULL WHERE id = ?',
      [newPinHash, user.id]
    );

    return res.json({ ok: true, message: 'PIN updated! Sign in with your new PIN.' });
  } catch (err) {
    console.error('[POST /api/auth/reset-pin Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;