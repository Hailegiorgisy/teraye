import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, withTransaction } from '../config/db.js';
import { requireAuth, requireRegisteredUser } from '../middleware/auth.js';

const router = Router();

/**
 * Helper: Normalizes Ethiopian phone numbers to +2519XXXXXXXX or +2517XXXXXXXX
 */
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

/**
 * Helper: Normalizes plate numbers (e.g., "aa 3 a45219" -> "AA-3-A45219")
 */
function normalizePlate(raw) {
  if (!raw) return null;
  return String(raw).trim().toUpperCase().replace(/\s+/g, '-');
}

/**
 * Helper: Issues a signed JWT for Mobile App / Web sessions
 */
function signUserToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
}

/**
 * 1. GET /api/auth/me
 * Called immediately when either the Telegram Mini App or Mobile App opens.
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    // Valid Telegram Mini App signature, but user is not in `users` table yet
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

    // Fetch linked taxi details if user is a DRIVER
    let taxi = null;
    if (req.user.role === 'DRIVER') {
      const taxiRes = await query(
        `SELECT t.id, t.plate_number, t.default_route_id, t.qr_token, t.status,
                r.destination_am, r.destination_en, r.route_code
         FROM taxis t
         LEFT JOIN routes r ON r.id = t.default_route_id
         WHERE t.driver_user_id = $1
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
 * First-time Telegram Mini App onboarding.
 * Links Telegram ID to +251 phone number (and claims pre-registered taxi if a marshal already added it!).
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
      // Check if a station marshal already created a user record with this phone number
      const existingUserRes = await client.query(
        'SELECT * FROM users WHERE phone_number = $1 LIMIT 1',
        [phone]
      );

      let user;
      if (existingUserRes.rows.length > 0) {
        // Link Telegram ID to the existing record created by the marshal
        const updated = await client.query(
          `UPDATE users
           SET telegram_id = $1, full_name = COALESCE(NULLIF($2, ''), full_name), updated_at = NOW()
           WHERE id = $3
           RETURNING id, telegram_id, phone_number, full_name, role, assigned_station_id, is_active`,
          [req.telegramUser.id, fullName, existingUserRes.rows[0].id]
        );
        user = updated.rows[0];
      } else {
        // Create brand-new DRIVER account
        const inserted = await client.query(
          `INSERT INTO users (telegram_id, phone_number, full_name, role)
           VALUES ($1, $2, $3, 'DRIVER')
           RETURNING id, telegram_id, phone_number, full_name, role, assigned_station_id, is_active`,
          [req.telegramUser.id, phone, fullName]
        );
        user = inserted.rows[0];
      }

      // If plate number provided, link or create taxi record
      let taxi = null;
      if (plate && user.role === 'DRIVER') {
        const taxiCheck = await client.query(
          'SELECT * FROM taxis WHERE plate_number = $1 LIMIT 1',
          [plate]
        );

        if (taxiCheck.rows.length > 0) {
          // Attach driver to existing taxi if not owned by someone else
          const existingTaxi = taxiCheck.rows[0];
          if (existingTaxi.driver_user_id && existingTaxi.driver_user_id !== user.id) {
            throw new Error('PLATE_ALREADY_CLAIMED');
          }
          const linked = await client.query(
            `UPDATE taxis
             SET driver_user_id = $1, default_route_id = COALESCE($2, default_route_id)
             WHERE id = $3
             RETURNING *`,
            [user.id, defaultRouteId, existingTaxi.id]
          );
          taxi = linked.rows[0];
        } else {
          const createdTaxi = await client.query(
            `INSERT INTO taxis (plate_number, driver_user_id, default_route_id)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [plate, user.id, defaultRouteId]
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
 * Standalone Mobile App (Android APK / PWA) login using +251 phone number + PIN.
 */
router.post('/mobile/login', async (req, res) => {
  try {
    const phone = normalizeEthPhone(req.body.phoneNumber);
    const pin = String(req.body.pin || '').trim();

    if (!phone || !pin) {
      return res.status(400).json({ error: 'Phone number and PIN are required.' });
    }

    const dbRes = await query(
      'SELECT * FROM users WHERE phone_number = $1 LIMIT 1',
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
    delete user.pin_hash; // Never return password/PIN hash to client

    return res.json({ token, user });
  } catch (err) {
    console.error('[POST /api/auth/mobile/login Error]:', err);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

/**
 * 4. POST /api/auth/mobile/set-pin
 * Allows an authenticated user (via Telegram Mini App or existing Mobile session)
 * to set a 4–6 digit PIN for standalone Mobile App login.
 */
router.post('/mobile/set-pin', requireAuth, requireRegisteredUser, async (req, res) => {
  try {
    const pin = String(req.body.pin || '').trim();
    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be 4 to 6 digits.' });
    }

    const pinHash = await bcrypt.hash(pin, 10);
    await query(
      'UPDATE users SET pin_hash = $1, updated_at = NOW() WHERE id = $2',
      [pinHash, req.user.id]
    );

    return res.json({ success: true, message: 'Mobile App PIN saved.' });
  } catch (err) {
    console.error('[POST /api/auth/mobile/set-pin Error]:', err);
    return res.status(500).json({ error: 'Failed to set PIN.' });
  }
});

export default router;