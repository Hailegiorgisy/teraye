import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { normalizeEthiopianPhone } from '../utils/phone.js';

// 1. Request a 6-digit PIN reset OTP via Telegram
router.post('/forgot-pin', async (req, res) => {
  try {
    const { phone } = req.body;
    const { candidates } = normalizeEthiopianPhone(phone);

    if (!candidates.length) {
      return res.status(400).json({ error: 'Enter a valid Ethiopian phone number.' });
    }

    const [rows] = await pool.query(
      'SELECT id, full_name, telegram_id FROM teraye_users WHERE phone IN (?, ?) AND is_active = 1 LIMIT 1',
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

    // Generate 6-digit OTP valid for 10 minutes
    const otp = String(crypto.randomInt(100000, 999999));
    const otpHash = await bcrypt.hash(otp, 10);

    await pool.query(
      'UPDATE teraye_users SET reset_otp_hash = ?, reset_otp_expires_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE id = ?',
      [otpHash, user.id]
    );

    // Send OTP via Telegram Bot API
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: user.telegram_id,
        text: `🔐 *Teraye (ተራየ) PIN Reset*\n\nHello ${user.full_name || 'User'}, your verification code is:\n\n\`${otp}\`\n\nExpires in 10 minutes. Do not share this code.`,
        parse_mode: 'Markdown',
      }),
    });

    if (!tgRes.ok) {
      return res.status(502).json({ error: 'Could not deliver Telegram code. Make sure you started the bot.' });
    }

    return res.json({ ok: true, message: 'Verification code sent to your Telegram.' });
  } catch (err) {
    console.error('forgot-pin error:', err);
    return res.status(500).json({ error: 'Failed to process PIN reset request.' });
  }
});

// 2. Verify OTP and save the new 4-6 digit PIN
router.post('/reset-pin', async (req, res) => {
  try {
    const { phone, otp, newPin } = req.body;
    const { candidates } = normalizeEthiopianPhone(phone);

    if (!candidates.length || !otp || !/^\d{4,6}$/.test(String(newPin).trim())) {
      return res.status(400).json({ error: 'Phone, 6-digit code, and a 4–6 digit new PIN are required.' });
    }

    const [rows] = await pool.query(
      `SELECT id, reset_otp_hash, reset_otp_expires_at
       FROM teraye_users
       WHERE phone IN (?, ?) AND is_active = 1 LIMIT 1`,
      [candidates[0], candidates[1] || candidates[0]]
    );

    const user = rows[0];
    if (!user || !user.reset_otp_hash || !user.reset_otp_expires_at) {
      return res.status(400).json({ error: 'No active reset request found. Request a new code.' });
    }

    if (new Date(user.reset_otp_expires_at) < new Date()) {
      return res.status(400).json({ error: 'Verification code expired. Request a new code.' });
    }

    const validOtp = await bcrypt.compare(String(otp).trim(), user.reset_otp_hash);
    if (!validOtp) {
      return res.status(401).json({ error: 'Incorrect verification code.' });
    }

    const newPinHash = await bcrypt.hash(String(newPin).trim(), 10);

    await pool.query(
      `UPDATE teraye_users
       SET pin_hash = ?, reset_otp_hash = NULL, reset_otp_expires_at = NULL
       WHERE id = ?`,
      [newPinHash, user.id]
    );

    return res.json({ ok: true, message: 'PIN updated successfully. You can now sign in.' });
  } catch (err) {
    console.error('reset-pin error:', err);
    return res.status(500).json({ error: 'Failed to reset PIN.' });
  }
});
router.get('/dev-session', async (req, res) => {
  if (process.env.DEV_BYPASS_AUTH !== 'true') {
    return res.status(403).json({ error: 'Dev bypass is disabled.' });
  }

  const [rows] = await pool.query(
    "SELECT id, full_name, phone, role, station_id, telegram_id FROM teraye_users WHERE role = 'ADMIN' AND is_active = 1 LIMIT 1"
  );

  const user = rows[0] || {
    id: 1,
    full_name: 'Dev Admin',
    phone: '+251921319216',
    role: 'ADMIN',
    station_id: 1,
  };

  const token = jwt.sign(
    { id: user.id, role: user.role, station_id: user.station_id },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );

  return res.json({ token, user });
});