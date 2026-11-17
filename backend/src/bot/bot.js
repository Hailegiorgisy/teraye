import { Telegraf, Markup } from 'telegraf';
import { query } from '../config/db.js';

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const miniAppUrl = process.env.MINI_APP_URL || 'https://korcha.com.et';

export const bot = botToken ? new Telegraf(botToken) : null;

if (bot) {
  /**
   * 1. /start — Welcome & Launch Mini App Button
   */
  bot.start(async (ctx) => {
    const firstName = ctx.from?.first_name || 'Driver';
    const welcomeText =
      `ሰላም ${firstName}! Welcome to *ተራየ (Teraye)* 🚖\n\n` +
      `• Tap *Open Teraye* below to view your live queue position, check in taxis, or manage routes.\n` +
      `• Or send /turn anytime for an instant low-data queue status check.`;

    await ctx.replyWithMarkdown(
      welcomeText,
      Markup.inlineKeyboard([
        [Markup.button.webApp('🚖 Open Teraye (ተራየ)', miniAppUrl)],
      ])
    );
  });

  /**
   * 2. /turn — Instant Low-Data Queue Position Check
   */
  bot.command('turn', async (ctx) => {
    try {
      const telegramId = ctx.from?.id;
      if (!telegramId) return;

      // Find user and their linked taxi
      const userRes = await query(
        `SELECT u.id, u.full_name, u.role, t.id AS taxi_id, t.plate_number
         FROM users u
         LEFT JOIN taxis t ON t.driver_user_id = u.id
         WHERE u.telegram_id = $1
         LIMIT 1`,
        [telegramId]
      );

      if (userRes.rows.length === 0) {
        return ctx.reply(
          'You are not registered yet. Tap "Open Teraye" to link your +251 phone number and plate.',
          Markup.inlineKeyboard([
            [Markup.button.webApp('🚖 Register Now', miniAppUrl)],
          ])
        );
      }

      const record = userRes.rows[0];
      if (!record.taxi_id) {
        return ctx.reply(
          `Hello ${record.full_name} (${record.role}). Open the Mini App to manage station queues.`,
          Markup.inlineKeyboard([
            [Markup.button.webApp('🚖 Open Teraye', miniAppUrl)],
          ])
        );
      }

      // Check if the taxi is currently in an active queue (WAITING or LOADING)
      const activeRes = await query(
        `SELECT qe.id, qe.station_id, qe.route_id, qe.arrived_at, qe.status,
                s.name_am AS station_am, s.name_en AS station_en,
                r.destination_am, r.destination_en
         FROM queue_entries qe
         JOIN stations s ON s.id = qe.station_id
         JOIN routes r ON r.id = qe.route_id
         WHERE qe.taxi_id = $1 AND qe.status IN ('WAITING', 'LOADING')
         LIMIT 1`,
        [record.taxi_id]
      );

      if (activeRes.rows.length === 0) {
        return ctx.reply(
          `🚖 Plate *${record.plate_number}*\nStatus: Not currently in any station queue.`,
          { parse_mode: 'Markdown' }
        );
      }

      const active = activeRes.rows[0];

      // Calculate exact FIFO rank (1-based) on that station + route
      const rankRes = await query(
        `SELECT COUNT(*)::int AS ahead
         FROM queue_entries
         WHERE station_id = $1
           AND route_id = $2
           AND status IN ('WAITING', 'LOADING')
           AND arrived_at <= $3`,
        [active.station_id, active.route_id, active.arrived_at]
      );

      const position = rankRes.rows[0].ahead;
      const statusBadge =
        position === 1
          ? '🟢 *YOUR TURN (#1) — Proceed to loading bay!*'
          : position === 2
          ? '🟡 *GET READY (#2) — You are next in line!*'
          : `⏳ Queue Position: *#${position}*`;

      return ctx.replyWithMarkdown(
        `🚖 *${record.plate_number}*\n` +
          `📍 Terminal: *${active.station_en}* (${active.station_am})\n` +
          `➡️ Route: *${active.destination_en}* (${active.destination_am})\n\n` +
          `${statusBadge}`,
        Markup.inlineKeyboard([
          [Markup.button.webApp('📋 View Full Lineup', miniAppUrl)],
        ])
      );
    } catch (err) {
      console.error('[Bot /turn Error]:', err);
      return ctx.reply('Unable to fetch queue status right now. Please try again shortly.');
    }
  });
}

/**
 * 3. Reusable Push Alert Helper (Called by Queue Engine when positions shift)
 */
export async function notifyDriverTurn(telegramId, { plateNumber, position, stationName, destinationName }) {
  if (!bot || !telegramId) return;

  try {
    let message = '';
    if (position === 1) {
      message =
        `🟢 *ተራህ ደርሷል! (YOUR TURN — #1)*\n` +
        `Plate *${plateNumber}* is now #1 at *${stationName}* → *${destinationName}*.\n` +
        `Proceed to the loading bay now.`;
    } else if (position === 2) {
      message =
        `🟡 *ተዘጋጅ! (GET READY — #2)*\n` +
        `Plate *${plateNumber}* is #2 at *${stationName}* → *${destinationName}*.\n` +
        `You are next to load passengers.`;
    } else {
      return; // Only send push alerts for #1 and #2 to avoid notification spam
    }

    await bot.telegram.sendMessage(telegramId, message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.webApp('🚖 Open Teraye', miniAppUrl)],
      ]),
    });
  } catch (err) {
    // Non-blocking: driver might have blocked the bot; log and continue without breaking dispatch
    console.warn(`[Bot Notify Warning] Could not message telegramId=${telegramId}:`, err.message);
  }
}