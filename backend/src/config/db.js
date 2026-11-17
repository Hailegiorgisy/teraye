import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// 1. PostgreSQL Connection Pool
export const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'teraye_db',
  user: process.env.DB_USER || 'teraye_user',
  password: process.env.DB_PASSWORD,
  max: 15,                       // Maximum simultaneous connections (safe for Plesk VPS)
  idleTimeoutMillis: 30000,      // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Fail fast (5s) if DB is unreachable
});

// Log unexpected pool errors so Plesk/PM2 captures them cleanly
pool.on('error', (err) => {
  console.error('[DB Pool Error] Unexpected PostgreSQL error:', err);
});

// 2. Simple Query Helper (for standard SELECT / INSERT / UPDATE)
export const query = (text, params) => pool.query(text, params);

// 3. Atomic Transaction Helper (for Check-In, Dispatch, & Re-Queue)
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// 4. Dynamic Runtime Setting Loader (DB override -> .env fallback)
export async function getSetting(key, fallbackValue = null) {
  try {
    const res = await pool.query(
      'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
      [key]
    );
    if (res.rows.length > 0) {
      return res.rows[0].value;
    }
  } catch (err) {
    console.warn(`[Config] Failed reading setting "${key}" from DB, using .env fallback.`);
  }
  return process.env[key] ?? fallbackValue;
}