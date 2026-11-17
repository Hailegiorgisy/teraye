import { Router } from 'express';
import { query, withTransaction, getSetting } from '../config/db.js';
import {
  requireAuth,
  requireRegisteredUser,
  requireRole,
} from '../middleware/auth.js';
import { notifyDriverTurn } from '../bot/bot.js';

const router = Router();

/**
 * Helper: Fetches top 2 waiting taxis on a station+route and sends Telegram Bot alerts
 */
async function triggerTopTwoNotifications(stationId, routeId) {
  try {
    const topRes = await query(
      `SELECT qe.id, t.plate_number, u.telegram_id,
              s.name_en AS station_name, r.destination_en AS destination_name
       FROM queue_entries qe
       JOIN taxis t ON t.id = qe.taxi_id
       LEFT JOIN users u ON u.id = t.driver_user_id
       JOIN stations s ON s.id = qe.station_id
       JOIN routes r ON r.id = qe.route_id
       WHERE qe.station_id = $1
         AND qe.route_id = $2
         AND qe.status IN ('WAITING', 'LOADING')
       ORDER BY qe.arrived_at ASC
       LIMIT 2`,
      [stationId, routeId]
    );

    for (let i = 0; i < topRes.rows.length; i++) {
      const row = topRes.rows[i];
      if (row.telegram_id) {
        await notifyDriverTurn(row.telegram_id, {
          plateNumber: row.plate_number,
          position: i + 1, // 1 = Your turn, 2 = Get ready
          stationName: row.station_name,
          destinationName: row.destination_name,
        });
      }
    }
  } catch (err) {
    console.warn('[Queue Notify Helper Warning]:', err.message);
  }
}

/**
 * 1. POST /api/queue/check-in  (Station Worker / Admin)
 * "Tick Arrival" — Adds a taxi to the FIFO queue.
 * Supports dynamic route selection (`routeId`) if traffic/demand forces a route change.
 */
router.post(
  '/check-in',
  requireAuth,
  requireRegisteredUser,
  requireRole('WORKER', 'ADMIN'),
  async (req, res) => {
    try {
      const { taxiId, routeId: overrideRouteId, notes } = req.body;
      const stationId = Number(req.body.stationId || req.user.assigned_station_id);

      if (!taxiId || !stationId) {
        return res.status(400).json({ error: 'taxiId and stationId are required.' });
      }

      // Workers can only check taxis into their own assigned terminal
      if (
        req.user.role === 'WORKER' &&
        req.user.assigned_station_id &&
        req.user.assigned_station_id !== stationId
      ) {
        return res.status(403).json({ error: 'You are not assigned to this terminal.' });
      }

      const created = await withTransaction(async (client) => {
        // 1. Verify taxi exists and is active
        const taxiRes = await client.query(
          'SELECT id, plate_number, default_route_id, status FROM taxis WHERE id = $1 LIMIT 1',
          [taxiId]
        );
        if (taxiRes.rows.length === 0) throw new Error('TAXI_NOT_FOUND');
        const taxi = taxiRes.rows[0];
        if (taxi.status !== 'ACTIVE') throw new Error('TAXI_SUSPENDED');

        // 2. Use provided routeId (if redirected) or fall back to taxi's default route
        const activeRouteId = Number(overrideRouteId || taxi.default_route_id);
        if (!activeRouteId) throw new Error('ROUTE_REQUIRED');

        // Verify route belongs to this station
        const routeCheck = await client.query(
          'SELECT id FROM routes WHERE id = $1 AND origin_station_id = $2 AND is_active = TRUE LIMIT 1',
          [activeRouteId, stationId]
        );
        if (routeCheck.rows.length === 0) throw new Error('INVALID_ROUTE_FOR_STATION');

        // 3. Insert into queue_entries (DB partial unique index blocks duplicates automatically)
        const insertRes = await client.query(
          `INSERT INTO queue_entries (taxi_id, station_id, route_id, checked_in_by, status)
           VALUES ($1, $2, $3, $4, 'WAITING')
           RETURNING *`,
          [taxi.id, stationId, activeRouteId, req.user.id]
        );
        const entry = insertRes.rows[0];

        // 4. Write audit log
        const isRouteSwitched =
          taxi.default_route_id && taxi.default_route_id !== activeRouteId;
        await client.query(
          `INSERT INTO queue_audit_logs (queue_entry_id, action_by, action_type, notes)
           VALUES ($1, $2, $3, $4)`,
          [
            entry.id,
            req.user.id,
            isRouteSwitched ? 'ROUTE_CHANGE' : 'CHECK_IN',
            notes || (isRouteSwitched ? `Checked in on alternate route #${activeRouteId}` : null),
          ]
        );

        // 5. Compute immediate FIFO rank for this vehicle
        const rankRes = await client.query(
          `SELECT COUNT(*)::int AS rank
           FROM queue_entries
           WHERE station_id = $1 AND route_id = $2
             AND status IN ('WAITING', 'LOADING')
             AND arrived_at <= $3`,
          [stationId, activeRouteId, entry.arrived_at]
        );

        return { entry, rank: rankRes.rows[0].rank, stationId, routeId: activeRouteId };
      });

      // Notify if this taxi just entered directly at #1 or #2 (empty/short queue)
      if (created.rank <= 2) {
        triggerTopTwoNotifications(created.stationId, created.routeId);
      }

      return res.status(201).json({
        entry: created.entry,
        position: created.rank,
      });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'This taxi is already in an active queue.' });
      }
      const map = {
        TAXI_NOT_FOUND: [404, 'Taxi not found.'],
        TAXI_SUSPENDED: [403, 'Taxi is suspended.'],
        ROUTE_REQUIRED: [400, 'Please select a destination route for this trip.'],
        INVALID_ROUTE_FOR_STATION: [400, 'Selected route does not belong to this terminal.'],
      };
      if (map[err.message]) {
        return res.status(map[err.message][0]).json({ error: map[err.message][1] });
      }
      console.error('[POST /api/queue/check-in Error]:', err);
      return res.status(500).json({ error: 'Failed to check in taxi.' });
    }
  }
);

/**
 * 2. POST /api/queue/:entryId/dispatch  (Station Worker / Admin)
 * "Tick Departure" — Marks taxi DISPATCHED and notifies the new #1 and #2 drivers.
 */
router.post(
  '/:entryId/dispatch',
  requireAuth,
  requireRegisteredUser,
  requireRole('WORKER', 'ADMIN'),
  async (req, res) => {
    try {
      const { entryId } = req.params;

      const dispatched = await withTransaction(async (client) => {
        const entryRes = await client.query(
          `SELECT * FROM queue_entries
           WHERE id = $1 AND status IN ('WAITING', 'LOADING')
           FOR UPDATE`,
          [entryId]
        );

        if (entryRes.rows.length === 0) throw new Error('ENTRY_NOT_ACTIVE');
        const entry = entryRes.rows[0];

        if (
          req.user.role === 'WORKER' &&
          req.user.assigned_station_id &&
          req.user.assigned_station_id !== entry.station_id
        ) {
          throw new Error('WRONG_STATION');
        }

        const updatedRes = await client.query(
          `UPDATE queue_entries
           SET status = 'DISPATCHED', dispatched_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [entryId]
        );

        await client.query(
          `INSERT INTO queue_audit_logs (queue_entry_id, action_by, action_type, notes)
           VALUES ($1, $2, 'DISPATCH', $3)`,
          [entryId, req.user.id, req.body.notes || null]
        );

        return updatedRes.rows[0];
      });

      // Asynchronously notify the next two drivers in line (#1 and #2)
      triggerTopTwoNotifications(dispatched.station_id, dispatched.route_id);

      return res.json({ entry: dispatched });
    } catch (err) {
      if (err.message === 'ENTRY_NOT_ACTIVE') {
        return res.status(404).json({ error: 'Queue entry is not active or already dispatched.' });
      }
      if (err.message === 'WRONG_STATION') {
        return res.status(403).json({ error: 'You are not assigned to this terminal.' });
      }
      console.error('[POST /api/queue/:entryId/dispatch Error]:', err);
      return res.status(500).json({ error: 'Failed to dispatch taxi.' });
    }
  }
);

/**
 * 3. POST /api/queue/:entryId/exception  (Station Worker / Admin)
 * Handles SKIP, CANCEL, or 5-minute Breakdown REQUEUE back to the front of the line.
 */
router.post(
  '/:entryId/exception',
  requireAuth,
  requireRegisteredUser,
  requireRole('WORKER', 'ADMIN'),
  async (req, res) => {
    try {
      const { entryId } = req.params;
      const action = String(req.body.action || '').toUpperCase();
      const notes = String(req.body.notes || '').trim() || null;

      if (!['SKIP', 'CANCEL', 'REQUEUE'].includes(action)) {
        return res.status(400).json({ error: 'Action must be SKIP, CANCEL, or REQUEUE.' });
      }

      const graceMinutes = Number(await getSetting('BREAKDOWN_GRACE_MINUTES', '5'));

      const updated = await withTransaction(async (client) => {
        const entryRes = await client.query(
          'SELECT * FROM queue_entries WHERE id = $1 FOR UPDATE',
          [entryId]
        );
        if (entryRes.rows.length === 0) throw new Error('NOT_FOUND');
        const entry = entryRes.rows[0];

        if (action === 'REQUEUE') {
          // Only allow re-queue if dispatched within BREAKDOWN_GRACE_MINUTES
          if (entry.status !== 'DISPATCHED' || !entry.dispatched_at) {
            throw new Error('CANNOT_REQUEUE');
          }
          const minsSinceDispatch =
            (Date.now() - new Date(entry.dispatched_at).getTime()) / 60000;
          if (minsSinceDispatch > graceMinutes) {
            throw new Error('GRACE_EXPIRED');
          }

          // Keep original `arrived_at` so the taxi returns cleanly to Position #1
          const rqRes = await client.query(
            `UPDATE queue_entries
             SET status = 'WAITING', dispatched_at = NULL
             WHERE id = $1
             RETURNING *`,
            [entryId]
          );
          await client.query(
            `INSERT INTO queue_audit_logs (queue_entry_id, action_by, action_type, notes)
             VALUES ($1, $2, 'REQUEUE', $3)`,
            [entryId, req.user.id, notes || 'Mechanical breakdown re-entry']
          );
          return rqRes.rows[0];
        }

        // SKIP or CANCEL an active entry
        if (!['WAITING', 'LOADING'].includes(entry.status)) {
          throw new Error('ENTRY_NOT_ACTIVE');
        }
        const nextStatus = action === 'SKIP' ? 'SKIPPED' : 'CANCELLED';
        const upRes = await client.query(
          `UPDATE queue_entries SET status = $1 WHERE id = $2 RETURNING *`,
          [nextStatus, entryId]
        );
        await client.query(
          `INSERT INTO queue_audit_logs (queue_entry_id, action_by, action_type, notes)
           VALUES ($1, $2, $3, $4)`,
          [entryId, req.user.id, action, notes]
        );
        return upRes.rows[0];
      });

      triggerTopTwoNotifications(updated.station_id, updated.route_id);
      return res.json({ entry: updated });
    } catch (err) {
      const map = {
        NOT_FOUND: [404, 'Queue entry not found.'],
        ENTRY_NOT_ACTIVE: [400, 'Queue entry is no longer active.'],
        CANNOT_REQUEUE: [400, 'Only recently dispatched taxis can be re-queued.'],
        GRACE_EXPIRED: [400, 'Breakdown re-entry grace window has expired.'],
      };
      if (map[err.message]) {
        return res.status(map[err.message][0]).json({ error: map[err.message][1] });
      }
      console.error('[POST /api/queue/:entryId/exception Error]:', err);
      return res.status(500).json({ error: 'Failed to process queue exception.' });
    }
  }
);
/**
 * 4. GET /api/queue/station/:stationId?routeId=12  (Station Worker / Admin)
 * Live Terminal Queue Board — Returns ordered FIFO entries + recent dispatches.
 */
router.get(
  '/station/:stationId',
  requireAuth,
  requireRegisteredUser,
  requireRole('WORKER', 'ADMIN'),
  async (req, res) => {
    try {
      const stationId = Number(req.params.stationId);
      const routeId = req.query.routeId ? Number(req.query.routeId) : null;

      if (!stationId) {
        return res.status(400).json({ error: 'Valid stationId is required.' });
      }

      // Active queue ordered strictly by FIFO per route
      const params = [stationId];
      let routeFilterSql = '';
      if (routeId) {
        params.push(routeId);
        routeFilterSql = 'AND qe.route_id = $2';
      }

      const activeRes = await query(
        `SELECT
           qe.id,
           qe.taxi_id,
           qe.route_id,
           qe.arrived_at,
           qe.status,
           ROW_NUMBER() OVER (PARTITION BY qe.route_id ORDER BY qe.arrived_at ASC)::int AS position,
           EXTRACT(EPOCH FROM (NOW() - qe.arrived_at))::int / 60 AS wait_minutes,
           t.plate_number,
           u.full_name AS driver_name,
           u.phone_number AS driver_phone,
           r.destination_am,
           r.destination_en,
           r.route_code
         FROM queue_entries qe
         JOIN taxis t ON t.id = qe.taxi_id
         LEFT JOIN users u ON u.id = t.driver_user_id
         JOIN routes r ON r.id = qe.route_id
         WHERE qe.station_id = $1
           AND qe.status IN ('WAITING', 'LOADING')
           ${routeFilterSql}
         ORDER BY qe.route_id ASC, qe.arrived_at ASC`,
        params
      );

      // Recently dispatched taxis (last 15 mins) — allows 1-tap Breakdown Re-Queue
      const recentRes = await query(
        `SELECT
           qe.id,
           qe.route_id,
           qe.dispatched_at,
           t.plate_number,
           r.destination_en,
           r.route_code
         FROM queue_entries qe
         JOIN taxis t ON t.id = qe.taxi_id
         JOIN routes r ON r.id = qe.route_id
         WHERE qe.station_id = $1
           AND qe.status = 'DISPATCHED'
           AND qe.dispatched_at >= NOW() - INTERVAL '15 minutes'
           ${routeFilterSql}
         ORDER BY qe.dispatched_at DESC
         LIMIT 10`,
        params
      );

      return res.json({
        stationId,
        queue: activeRes.rows,
        recentDispatches: recentRes.rows,
      });
    } catch (err) {
      console.error('[GET /api/queue/station/:stationId Error]:', err);
      return res.status(500).json({ error: 'Failed to load station queue.' });
    }
  }
);

/**
 * 5. GET /api/queue/my-turn  (Driver)
 * Live Driver View — Exact rank, plates ahead, wait estimate, and recent trip history.
 */
router.get(
  '/my-turn',
  requireAuth,
  requireRegisteredUser,
  async (req, res) => {
    try {
      // Find driver's linked taxi
      const taxiRes = await query(
        `SELECT t.id, t.plate_number, t.qr_token, t.default_route_id,
                r.destination_am AS default_dest_am, r.destination_en AS default_dest_en
         FROM taxis t
         LEFT JOIN routes r ON r.id = t.default_route_id
         WHERE t.driver_user_id = $1
         LIMIT 1`,
        [req.user.id]
      );

      if (taxiRes.rows.length === 0) {
        return res.json({ taxi: null, activeQueue: null, recentTrips: [] });
      }
      const taxi = taxiRes.rows[0];

      // Check if currently in an active queue
      const activeRes = await query(
        `SELECT qe.id, qe.station_id, qe.route_id, qe.arrived_at, qe.status,
                s.name_am AS station_am, s.name_en AS station_en,
                r.destination_am, r.destination_en, r.route_code
         FROM queue_entries qe
         JOIN stations s ON s.id = qe.station_id
         JOIN routes r ON r.id = qe.route_id
         WHERE qe.taxi_id = $1 AND qe.status IN ('WAITING', 'LOADING')
         LIMIT 1`,
        [taxi.id]
      );

      let activeQueue = null;
      if (activeRes.rows.length > 0) {
        const entry = activeRes.rows[0];

        // Fetch all active vehicles on this same station + route to compute rank & plates ahead
        const lineRes = await query(
          `SELECT qe.id, t.plate_number, qe.arrived_at
           FROM queue_entries qe
           JOIN taxis t ON t.id = qe.taxi_id
           WHERE qe.station_id = $1
             AND qe.route_id = $2
             AND qe.status IN ('WAITING', 'LOADING')
           ORDER BY qe.arrived_at ASC`,
          [entry.station_id, entry.route_id]
        );

        const myIndex = lineRes.rows.findIndex((r) => r.id === entry.id);
        const position = myIndex >= 0 ? myIndex + 1 : 1;
        const platesAhead = lineRes.rows
          .slice(0, Math.max(0, myIndex))
          .map((r) => r.plate_number);

        activeQueue = {
          ...entry,
          position,
          totalInLine: lineRes.rows.length,
          platesAhead,
          // Rough estimate: ~4 mins per minibus ahead (refineable later from real dispatch velocity)
          estimatedWaitMinutes: Math.max(0, (position - 1) * 4),
        };
      }

      // Fetch driver's last 10 completed dispatches
      const historyRes = await query(
        `SELECT qe.id, qe.arrived_at, qe.dispatched_at,
                s.name_en AS station_en, r.destination_en, r.route_code
         FROM queue_entries qe
         JOIN stations s ON s.id = qe.station_id
         JOIN routes r ON r.id = qe.route_id
         WHERE qe.taxi_id = $1 AND qe.status = 'DISPATCHED'
         ORDER BY qe.dispatched_at DESC
         LIMIT 10`,
        [taxi.id]
      );

      return res.json({
        taxi,
        activeQueue,
        recentTrips: historyRes.rows,
      });
    } catch (err) {
      console.error('[GET /api/queue/my-turn Error]:', err);
      return res.status(500).json({ error: 'Failed to load driver turn status.' });
    }
  }
);

export default router;