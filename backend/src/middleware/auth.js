import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';

/**
 * Cryptographically verifies Telegram WebApp initData using HMAC-SHA256
 * per official Telegram Mini App security specifications.
 */
function verifyTelegramInitData(initDataRaw, botToken) {
  if (!initDataRaw || !botToken) return null;

  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash) return null;

  // Reject stale payloads older than 24 hours (86400 seconds)
  const authDate = Number(params.get('auth_date'));
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!authDate || nowSeconds - authDate > 86400) {
    return null;
  }

  params.delete('hash');

  // Sort keys alphabetically and join with newline
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${key}=${val}`)
    .join('\n');

  // Step 1: secret_key = HMAC_SHA256("WebAppData", bot_token)
  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  // Step 2: calculated_hash = HMAC_SHA256(secret_key, data_check_string)
  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  const isValid =
    calculatedHash.length === hash.length &&
    crypto.timingSafeEqual(Buffer.from(calculatedHash), Buffer.from(hash));

  if (!isValid) return null;

  try {
    return JSON.parse(params.get('user'));
  } catch {
    return null;
  }
}

/**
 * Unified Auth Middleware:
 * Supports both:
 *   1. Header `x-telegram-init-data: <raw_init_data>` (Telegram Mini App)
 *   2. Header `Authorization: Bearer <jwt_token>`    (Standalone Mobile App / Web)
 */
export async function requireAuth(req, res, next) {
  try {
    const tgInitData = req.headers['x-telegram-init-data'];
    const authHeader = req.headers['authorization'];

    // --- Path A: Telegram Mini App Authentication ---
    if (tgInitData) {
      const tgUser = verifyTelegramInitData(
        tgInitData,
        process.env.TELEGRAM_BOT_TOKEN
      );

      if (!tgUser?.id) {
        return res.status(401).json({ error: 'Invalid or expired Telegram session.' });
      }

      const dbRes = await query(
        'SELECT id, telegram_id, phone_number, full_name, role, assigned_station_id, is_active FROM users WHERE telegram_id = $1 LIMIT 1',
        [tgUser.id]
      );

      if (dbRes.rows.length === 0) {
        // User has valid Telegram signature, but hasn't completed phone registration yet
        req.telegramUser = tgUser;
        req.user = null;
        return next();
      }

      const user = dbRes.rows[0];
      if (!user.is_active) {
        return res.status(403).json({ error: 'Account is suspended. Contact station administrator.' });
      }

      req.user = user;
      return next();
    }

    // --- Path B: Mobile App / Web JWT Authentication ---
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const dbRes = await query(
        'SELECT id, telegram_id, phone_number, full_name, role, assigned_station_id, is_active FROM users WHERE id = $1 LIMIT 1',
        [decoded.userId]
      );

      if (dbRes.rows.length === 0 || !dbRes.rows[0].is_active) {
        return res.status(401).json({ error: 'Invalid or inactive user token.' });
      }

      req.user = dbRes.rows[0];
      return next();
    }

    return res.status(401).json({ error: 'Authentication credentials required.' });
  } catch (err) {
    console.error('[Auth Middleware Error]:', err.message);
    return res.status(401).json({ error: 'Unauthorized request.' });
  }
}

/**
 * Ensures the authenticated user has completed registration in `users` table
 */
export function requireRegisteredUser(req, res, next) {
  if (!req.user) {
    return res.status(403).json({
      error: 'Registration incomplete. Please link your +251 phone number first.',
      code: 'ONBOARDING_REQUIRED',
    });
  }
  next();
}

/**
 * Role-Based Access Guard: e.g., requireRole('WORKER', 'ADMIN')
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}.`,
      });
    }
    next();
  };
}