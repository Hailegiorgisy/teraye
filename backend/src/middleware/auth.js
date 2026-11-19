import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'teraye_temp_secret_2026';

export async function requireAuth(req, res, next) {
  if (process.env.DEV_BYPASS_AUTH === 'true') {
    try {
      const dbRes = await query(
        "SELECT id, telegram_id, phone_number, full_name, role, assigned_station_id, is_active FROM teraye_users WHERE role IN ('ADMIN', 'WORKER') AND is_active = 1 LIMIT 1"
      );
      req.user = dbRes.rows[0] || {
        id: '00000000-0000-0000-0000-000000000001',
        full_name: 'Dev Admin',
        phone_number: '+251921319216',
        role: 'ADMIN',
        assigned_station_id: 1,
        is_active: 1,
      };
      return next();
    } catch (err) {
      return next(err);
    }
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const uid = decoded.userId || decoded.id;
    const dbRes = await query(
      'SELECT id, telegram_id, phone_number, full_name, role, assigned_station_id, is_active FROM teraye_users WHERE id = ? AND is_active = 1 LIMIT 1',
      [uid]
    );
    if (dbRes.rows.length === 0) {
      return res.status(401).json({ error: 'User not found or inactive.' });
    }
    req.user = dbRes.rows[0];
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

export function requireRegisteredUser(req, res, next) {
  if (!req.user) {
    return res.status(403).json({ error: 'Registered user account required.' });
  }
  return next();
}