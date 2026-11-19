import crypto from 'crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, withTransaction } from '../config/db.js';
import { requireAuth, requireRegisteredUser } from '../middleware/auth.js';

const router = Router();

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

function normalizePlate(raw) {
  if (!raw) return null;
  return String(raw).trim().toUpperCase().replace(/\s+/g, '-');
}

function signUserToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
}

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
    return res.status(500).json({ error: 'Failed to load profile.' });
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
    return res.status(500).json({ error: 'Registration failed.' });
  }
});

/**
 * 3. POST /api/auth/mobile/login
 */
router.post('/mobile/login', async (req, res) => {
  try {
    const phone = normalizeEthPhone(req.body.phoneNumber);
    const pin = String(req.body.pin || '').trim();

    if (!phone || !pin) {
      return res.status(400).json({ error: 'Phone number and PIN are required.' });
    }

    const dbRes = await query(
      'SELECT * FROM teraye_users WHERE phone_number = ? LIMIT 1',
      [phone]
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
    return res.status(500).json({ error: 'Login failed.' });
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
    return res.status(500).json({ error: 'Failed to set PIN.' });
  }
});

export default router;