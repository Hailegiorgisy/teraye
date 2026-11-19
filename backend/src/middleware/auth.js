import jwt from 'jsonwebtoken';
import pool from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'teraye_temp_secret_2026';

export async function requireAuth(req, res, next) {
  if (process.env.DEV_BYPASS_AUTH === 'true') {
    try {
      const [rows] = await pool.query(
        "SELECT id, full_name, phone_number, role, assigned_station_id, telegram_id FROM teraye_users WHERE role IN ('ADMIN', 'WORKER') AND is_active = 1 LIMIT 1"
      );
      req.user = rows[0] || {
        id: '00000000-0000-0000-0000-000000000001',
        full_name: 'Dev Admin',
        phone_number: '+251921319216',
        role: 'ADMIN',
        assigned_station_id: 1,
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
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}