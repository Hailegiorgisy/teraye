import crypto from 'crypto';
import { Router } from 'express';
import { query, withTransaction, getSetting } from '../config/db.js';
import {
  requireAuth,
  requireRegisteredUser,
  requireRole,
} from '../middleware/auth.js';
import { notifyDriverTurn } from '../bot/bot.js';

const router = Router();

async function triggerTopTwoNotifications(stationId, routeId) {
  try {
    const topRes = await query(
      `SELECT qe.id, t.plate_number, u.telegram_id,
              s.name_en AS station_name, r.destination_en AS destination_name
       FROM teraye_queue_entries qe
       JOIN teraye_taxis t ON t.id = qe.taxi_id
       LEFT JOIN teraye_users u ON u.id = t.driver_user_id
       JOIN teraye_stations s ON s.id = qe.station_id
       JOIN teraye_routes r ON r.id = qe.route_id
       WHERE qe.station_id = ?
         AND qe.route_id = ?
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
          position: i + 1,
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
 * 1. POST /api/queue/check-in
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

      if (
        req.user.role === 'WORKER' &&
        req.user.assigned_station_id &&
        req.user.assigned_station_id !== stationId
      ) {
        return res.status(403).json({ error: 'You are not assigned to this terminal.' });
      }

      const created = await withTransaction(async (client) => {
        const taxiRes = await client.query(
          'SELECT id, plate_number, default_route_id, status FROM teraye_taxis WHERE id = ? LIMIT 1',
          [taxiId]
        );
        if (taxiRes.rows.length === 0) throw new Error('TAXI_NOT_FOUND');
        const taxi = taxiRes.rows[0];
        if (taxi.status !== 'ACTIVE') throw new Error('TAXI_SUSPENDED');

        const activeRouteId = Number(overrideRouteId || taxi.default_route_id);
        if (!activeRouteId) throw new Error('ROUTE_REQUIRED');

        const routeCheck = await client.query(
          'SELECT id FROM teraye_routes WHERE id = ? AND origin_station_id = ? AND is_active = TRUE LIMIT 1',
          [activeRouteId, stationId]
        );
        if (routeCheck.rows.length === 0) throw new Error('INVALID_ROUTE_FOR_STATION');

        const entryId = crypto.randomUUID();
        await client.query(
          `INSERT INTO teraye_queue_entries (id, taxi_id, station_id, route_id, checked_in_by, status)
           VALUES (?, ?, ?, ?, ?, 'WAITING')`,
          [entryId, taxi.id, stationId, activeRouteId, req.user.id]
        );

        const entryRes = await client.query(
          'SELECT * FROM teraye_queue_entries WHERE id = ? LIMIT 1',
          [entryId]
        );
        const entry = entryRes.rows[0];

        const isRouteSwitched =
          taxi.default_route_id && taxi.default_route_id !== activeRouteId;
        await client.query(
          `INSERT INTO teraye_queue_audit_logs (queue_entry_id, action_by, action_type, notes)
           VALUES (?, ?, ?, ?)`,
          [
            entry.id,
            req.user.id,
            isRouteSwitched ? 'ROUTE_CHANGE' : 'CHECK_IN',
            notes || (isRouteSwitched ? `Checked in on alternate route #${activeRouteId}` : null),
          ]
        );

        const rankRes = await client.query(
          `SELECT COUNT(*) AS rank_pos
           FROM teraye_queue_entries
           WHERE station_id = ? AND route_id = ?
             AND status IN ('WAITING', 'LOADING')
             AND arrived_at <= ?`,
          [stationId, activeRouteId, entry.arrived_at]
        );

        return {
          entry,
          rank: Number(rankRes.rows[0].rank_pos),
          stationId,
          routeId: activeRouteId,
        };
      });

      if (created.rank <= 2) {
        triggerTopTwoNotifications(created.stationId, created.routeId);
      }

      return res.status(201).json({
        entry: created.entry,
        position: created.rank,
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
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
 * 2. POST /api/queue/:entryId/dispatch
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
          `SELECT * FROM teraye_queue_entries
           WHERE id = ? AND status IN ('WAITING', 'LOADING')
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

        await client.query(
          `UPDATE teraye_queue_entries
           SET status = 'DISPATCHED', dispatched_at = CURRENT_TIMESTAMP(3)
           WHERE id = ?`,
          [entryId]
        );

        await client.query(
          `INSERT INTO teraye_queue_audit_logs (queue_entry_id, action_by, action_type, notes)
           VALUES (?, ?, 'DISPATCH', ?)`,
          [entryId, req.user.id, req.body.notes || null]
        );

        const updatedRes = await client.query(
          'SELECT * FROM teraye_queue_entries WHERE id = ? LIMIT 1',
          [entryId]
        );
        return updatedRes.rows[0];
      });

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
 * 3. POST /api/queue/:entryId/exception
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
          'SELECT * FROM teraye_queue_entries WHERE id = ? FOR UPDATE',
          [entryId]
        );
        if (entryRes.rows.length === 0) throw new Error('NOT_FOUND');
        const entry = entryRes.rows[0];

        if (action === 'REQUEUE') {
          if (entry.status !== 'DISPATCHED' || !entry.dispatched_at) {
            throw new Error('CANNOT_REQUEUE');
          }
          const minsSinceDispatch =
            (Date.now() - new Date(entry.dispatched_at).getTime()) / 60000;
          if (minsSinceDispatch > graceMinutes) {
            throw new Error('GRACE_EXPIRED');
          }

          await client.query(
            `UPDATE teraye_queue_entries
             SET status = 'WAITING', dispatched_at = NULL
             WHERE id = ?`,
            [entryId]
          );
          await client.query(
            `INSERT INTO teraye_queue_audit_logs (queue_entry_id, action_by, action_type, notes)
             VALUES (?, ?, 'REQUEUE', ?)`,
            [entryId, req.user.id, notes || 'Mechanical breakdown re-entry']
          );
        } else {
          if (!['WAITING', 'LOADING'].includes(entry.status)) {
            throw new Error('ENTRY_NOT_ACTIVE');
          }
          const nextStatus = action === 'SKIP' ? 'SKIPPED' : 'CANCELLED';
          await client.query(
            'UPDATE teraye_queue_entries SET status = ? WHERE id = ?',
            [nextStatus, entryId]
          );
          await client.query(
            `INSERT INTO teraye_queue_audit_logs (queue_entry_id, action_by, action_type, notes)
             VALUES (?, ?, ?, ?)`,
            [entryId, req.user.id, action, notes]
          );
        }

        const upRes = await client.query(
          'SELECT * FROM teraye_queue_entries WHERE id = ? LIMIT 1',
          [entryId]
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
 * 4. GET /api/queue/station/:stationId?routeId=12
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

      const params = [stationId];
      let routeFilterSql = '';
      if (routeId) {
        params.push(routeId);
        routeFilterSql = 'AND qe.route_id = ?';
      }

      const activeRes = await query(
        `SELECT
           qe.id,
           qe.taxi_id,
           qe.route_id,
           qe.arrived_at,
           qe.status,
           TIMESTAMPDIFF(MINUTE, qe.arrived_at, UTC_TIMESTAMP()) AS wait_minutes,
           t.plate_number,
           u.full_name AS driver_name,
           u.phone_number AS driver_phone,
           r.destination_am,
           r.destination_en,
           r.route_code
         FROM teraye_queue_entries qe
         JOIN teraye_taxis t ON t.id = qe.taxi_id
         LEFT JOIN teraye_users u ON u.id = t.driver_user_id
         JOIN teraye_routes r ON r.id = qe.route_id
         WHERE qe.station_id = ?
           AND qe.status IN ('WAITING', 'LOADING')
           ${routeFilterSql}
         ORDER BY qe.route_id ASC, qe.arrived_at ASC`,
        params
      );

      // Compute 1-based FIFO position per route in JS (works on both MySQL 5.7 and 8.0+)
      const routeCounters = new Map();
      const numberedQueue = activeRes.rows.map((row) => {
        const nextPos = (routeCounters.get(row.route_id) || 0) + 1;
        routeCounters.set(row.route_id, nextPos);
        return {
          ...row,
          position: nextPos,
          wait_minutes: Math.max(0, Number(row.wait_minutes || 0)),
        };
      });

      const recentRes = await query(
        `SELECT
           qe.id,
           qe.route_id,
           qe.dispatched_at,
           t.plate_number,
           r.destination_en,
           r.route_code
         FROM teraye_queue_entries qe
         JOIN teraye_taxis t ON t.id = qe.taxi_id
         JOIN teraye_routes r ON r.id = qe.route_id
         WHERE qe.station_id = ?
           AND qe.status = 'DISPATCHED'
           AND qe.dispatched_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)
           ${routeFilterSql}
         ORDER BY qe.dispatched_at DESC
         LIMIT 10`,
        params
      );

      return res.json({
        stationId,
        queue: numberedQueue,
        recentDispatches: recentRes.rows,
      });
    } catch (err) {
      console.error('[GET /api/queue/station/:stationId Error]:', err);
      return res.status(500).json({ error: 'Failed to load station queue.' });
    }
  }
);

/**
 * 5. GET /api/queue/my-turn
 */
router.get(
  '/my-turn',
  requireAuth,
  requireRegisteredUser,
  async (req, res) => {
    try {
      const taxiRes = await query(
        `SELECT t.id, t.plate_number, t.qr_token, t.default_route_id,
                r.destination_am AS default_dest_am, r.destination_en AS default_dest_en
         FROM teraye_taxis t
         LEFT JOIN teraye_routes r ON r.id = t.default_route_id
         WHERE t.driver_user_id = ?
         LIMIT 1`,
        [req.user.id]
      );

      if (taxiRes.rows.length === 0) {
        return res.json({ taxi: null, activeQueue: null, recentTrips: [] });
      }
      const taxi = taxiRes.rows[0];

      const activeRes = await query(
        `SELECT qe.id, qe.station_id, qe.route_id, qe.arrived_at, qe.status,
                s.name_am AS station_am, s.name_en AS station_en,
                r.destination_am, r.destination_en, r.route_code
         FROM teraye_queue_entries qe
         JOIN teraye_stations s ON s.id = qe.station_id
         JOIN teraye_routes r ON r.id = qe.route_id
         WHERE qe.taxi_id = ? AND qe.status IN ('WAITING', 'LOADING')
         LIMIT 1`,
        [taxi.id]
      );

      let activeQueue = null;
      if (activeRes.rows.length > 0) {
        const entry = activeRes.rows[0];

        const lineRes = await query(
          `SELECT qe.id, t.plate_number, qe.arrived_at
           FROM teraye_queue_entries qe
           JOIN teraye_taxis t ON t.id = qe.taxi_id
           WHERE qe.station_id = ?
             AND qe.route_id = ?
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
          estimatedWaitMinutes: Math.max(0, (position - 1) * 4),
        };
      }

      const historyRes = await query(
        `SELECT qe.id, qe.arrived_at, qe.dispatched_at,
                s.name_en AS station_en, r.destination_en, r.route_code
         FROM teraye_queue_entries qe
         JOIN teraye_stations s ON s.id = qe.station_id
         JOIN teraye_routes r ON r.id = qe.route_id
         WHERE qe.taxi_id = ? AND qe.status = 'DISPATCHED'
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