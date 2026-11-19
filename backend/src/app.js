import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load backend/.env explicitly so Phusion Passenger resolves env vars regardless of cwd
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pool, query } from './config/db.js';
import authRoutes from './routes/auth.routes.js';
import stationRoutes from './routes/stations.routes.js';
import queueRoutes from './routes/queue.routes.js';
import { bot } from './bot/bot.js';

const frontendDist = path.resolve(__dirname, '../public');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

// 1. Security & Body Parsing Middleware
app.use(
  helmet({
    // Allow Telegram WebApp iframe embedding
    contentSecurityPolicy: false,
  })
);

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  })
);

app.use(express.json({ limit: '256kb' }));

// 2. Health Check Endpoint (Verify Plesk + MySQL connectivity)
app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT NOW() AS server_time');
    return res.json({
      status: 'ok',
      app: process.env.APP_NAME || 'Teraye',
      time: rows[0].server_time,
    });
  } catch (err) {
    console.error('[Health Check Failed]:', err);
    return res.status(503).json({
      status: 'error',
      database: 'unreachable',
      detail: err.message,
      code: err.code,
    });
  }
});

// 3. Shared Core API Routes
app.use('/api/auth', authRoutes);
app.use('/api/stations', stationRoutes);
app.use('/api/queue', queueRoutes);

// 4. Telegram Bot Webhook Endpoint (Production on Plesk)
const webhookPath = '/api/telegram/webhook';
if (bot && isProd && process.env.PUBLIC_API_URL) {
  app.use(bot.webhookCallback(webhookPath));
}

// 5. Serve Built React Frontend (Telegram Mini App + PWA)
app.use(express.static(frontendDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// 6. Global 404 & Error Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// 7. Start Server & Bot
const server = app.listen(PORT, async () => {
  console.log(`🚀 ${process.env.APP_NAME || 'Teraye'} API running on port ${PORT}`);

  if (bot) {
    try {
      if (isProd && process.env.PUBLIC_API_URL) {
        const fullWebhookUrl = `${process.env.PUBLIC_API_URL.replace(/\/$/, '')}${webhookPath}`;
        await bot.telegram.setWebhook(fullWebhookUrl);
        console.log(`🤖 Telegram Bot webhook registered: ${fullWebhookUrl}`);
      } else {
        await bot.launch();
        console.log('🤖 Telegram Bot started in local polling mode');
      }
    } catch (botErr) {
      console.error('[Telegram Bot Startup Error]:', botErr.message);
    }
  }
});

// 8. Graceful Shutdown (Prevents broken DB transactions during Plesk/Git deploys)
async function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  if (bot && !isProd) {
    bot.stop(signal);
  }
  server.close(async () => {
    await pool.end();
    console.log('✅ HTTP server and MySQL pool closed.');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
