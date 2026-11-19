import jwt from 'jsonwebtoken';
import pool from '../db.js'; // adjust path to your MySQL pool

export async function requireAuth(req, res, next) {
  // Temporary development bypass (controlled via .env)
  if (process.env.DEV_BYPASS_AUTH === 'true') {
    try {
      const [rows] = await pool.query(
        "SELECT id, full_name, phone, role, station_id, telegram_id FROM teraye_users WHERE role = 'ADMIN' AND is_active = 1 LIMIT 1"
      );
      req.user = rows[0] || {
        id: 1,
        full_name: 'Dev Admin',
        phone: '+251921319216',
        role: 'ADMIN',
        station_id: 1,
      };
      return next();
    } catch (err) {
      return next(err);
    }
  }

  // Normal production JWT verification
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}