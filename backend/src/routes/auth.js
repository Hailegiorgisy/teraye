import { normalizeEthiopianPhone } from '../utils/phone.js';

// Inside your POST /api/auth/login handler:
const { phone, pin } = req.body;
const { candidates } = normalizeEthiopianPhone(phone);

if (!candidates.length || !pin) {
  return res.status(400).json({ error: 'Phone number and PIN are required.' });
}

const [rows] = await pool.query(
  'SELECT * FROM teraye_users WHERE phone IN (?, ?) AND is_active = 1 LIMIT 1',
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