import { Router } from 'express';
import { query, withTransaction } from '../config/db.js';
import {
  requireAuth,
  requireRegisteredUser,
  requireRole,
} from '../middleware/auth.js';

const router = Router();

/**
 * Helper: Normalizes plate numbers (e.g., "aa 3 a45219" -> "AA-3-A45219")
 */
function normalizePlate(raw) {
  if (!raw) return null;
  return String(raw).trim().toUpperCase().replace(/\s+/g, '-');
}

/**
 * Helper: Normalizes Ethiopian phone numbers to +2519XXXXXXXX or +2517XXXXXXXX
 */
function normalizeEthPhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('251') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+251${digits.slice(1)}`;
  if ((digits.startsWith('9') || digits.startsWith('7')) && digits.length === 9) {
    return `+251${digits}`;
  }
  return null;
}

/**
 * 1. GET /api/stations
 * Public/Shared endpoint: Returns all active stations and their active routes
 * in one compact payload (also used during first-time driver onboarding).
 */
router.get('/', async (req, res) => {
  try {
    const stationsRes = await query(
      `SELECT id, name_am, name_en, sub_city
       FROM stations
       WHERE is_active = TRUE
       ORDER BY name_en ASC`
    );

    const routesRes = await query(
      `SELECT id, origin_station_id, destination_am, destination_en, route_code
       FROM routes
       WHERE is_active = TRUE
       ORDER BY destination_en ASC`
    );

    // Group routes under their origin station in memory (1 fast DB round-trip)
    const routesByStation = new Map();
    for (const r of routesRes.rows) {
      if (!routesByStation.has(r.origin_station_id)) {
        routesByStation.set(r.origin_station_id, []);
      }
      routesByStation.get(r.origin_station_id).push(r);
    }

    const stations = stationsRes.rows.map((st) => ({
      ...st,
      routes: routesByStation.get(st.id) || [],
    }));

    return res.json({ stations });
  } catch (err) {
    console.error('[GET /api/stations Error]:', err);
    return res.status(500).json({ error: 'Failed to load stations and routes.' });
  }
});

/**
 * 2. POST /api/stations
 * Admin-only: Create a new taxi terminal.
 */
router.post(
  '/',
  requireAuth,
  requireRegisteredUser,
  requireRole('ADMIN'),
  async (req, res) => {
    try {
      const nameAm = String(req.body.nameAm || '').trim();
      const nameEn = String(req.body.nameEn || '').trim();
      const subCity = String(req.body.subCity || '').trim() || null;

      if (!nameAm || !nameEn) {
        return res
          .status(400)
          .json({ error: 'Both Amharic (nameAm) and English (nameEn) station names are required.' });
      }

      const result = await query(
        `INSERT INTO stations (name_am, name_en, sub_city)
         VALUES ($1, $2, $3)
         RETURNING id, name_am, name_en, sub_city, is_active`,
        [nameAm, nameEn, subCity]
      );

      return res.status(201).json({ station: result.rows[0] });
    } catch (err) {
      console.error('[POST /api/stations Error]:', err);
      return res.status(500).json({ error: 'Failed to create station.' });
    }
  }
);

/**
 * 3. POST /api/stations/:stationId/routes
 * Admin-only: Add a destination corridor departing from a station.
 */
router.post(
  '/:stationId/routes',
  requireAuth,
  requireRegisteredUser,
  requireRole('ADMIN'),
  async (req, res) => {
    try {
      const stationId = Number(req.params.stationId);
      const destinationAm = String(req.body.destinationAm || '').trim();
      const destinationEn = String(req.body.destinationEn || '').trim();
      const routeCode = String(req.body.routeCode || '').trim().toUpperCase();

      if (!stationId || !destinationAm || !destinationEn || !routeCode) {
        return res.status(400).json({
          error: 'stationId, destinationAm, destinationEn, and routeCode are required.',
        });
      }

      const result = await query(
        `INSERT INTO routes (origin_station_id, destination_am, destination_en, route_code)
         VALUES ($1, $2, $3, $4)
         RETURNING id, origin_station_id, destination_am, destination_en, route_code, is_active`,
        [stationId, destinationAm, destinationEn, routeCode]
      );

      return res.status(201).json({ route: result.rows[0] });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Route code already exists.' });
      }
      console.error('[POST /api/stations/:stationId/routes Error]:', err);
      return res.status(500).json({ error: 'Failed to create route.' });
    }
  }
);

/**
 * 4. GET /api/stations/taxis/search?q=45219  OR  ?qrToken=<uuid>
 * Used by Station Marshals for instant plate lookup or QR sticker scan.
 */
router.get(
  '/taxis/search',
  requireAuth,
  requireRegisteredUser,
  requireRole('WORKER', 'ADMIN'),
  async (req, res) => {
    try {
      const qrToken = String(req.query.qrToken || '').trim();
      const q = String(req.query.q || '').trim().toUpperCase();

      if (qrToken) {
        const qrRes = await query(
          `SELECT t.id, t.plate_number, t.default_route_id, t.qr_token, t.status,
                  u.full_name AS driver_name, u.phone_number AS driver_phone,
                  r.destination_am, r.destination_en, r.route_code
           FROM taxis t
           LEFT JOIN users u ON u.id = t.driver_user_id
           LEFT JOIN routes r ON r.id = t.default_route_id
           WHERE t.qr_token = $1
           LIMIT 1`,
          [qrToken]
        );
        return res.json({ taxis: qrRes.rows });
      }

      if (q.length < 2) {
        return res.status(400).json({ error: 'Enter at least 2 characters to search plates.' });
      }

      const searchRes = await query(
        `SELECT t.id, t.plate_number, t.default_route_id, t.qr_token, t.status,
                u.full_name AS driver_name, u.phone_number AS driver_phone,
                r.destination_am, r.destination_en, r.route_code
         FROM taxis t
         LEFT JOIN users u ON u.id = t.driver_user_id
         LEFT JOIN routes r ON r.id = t.default_route_id
         WHERE t.plate_number ILIKE $1
         ORDER BY t.plate_number ASC
         LIMIT 20`,
        [`%${q}%`]
      );

      return res.json({ taxis: searchRes.rows });
    } catch (err) {
      console.error('[GET /api/stations/taxis/search Error]:', err);
      return res.status(500).json({ error: 'Failed to search taxis.' });
    }
  }
);

/**
 * 5. POST /api/stations/taxis
 * Worker / Admin: Register a new taxi on the spot at the terminal.
 */
router.post(
  '/taxis',
  requireAuth,
  requireRegisteredUser,
  requireRole('WORKER', 'ADMIN'),
  async (req, res) => {
    try {
      const plate = normalizePlate(req.body.plateNumber);
      const driverName = String(req.body.driverName || '').trim();
      const driverPhone = normalizeEthPhone(req.body.driverPhone);
      const defaultRouteId = req.body.defaultRouteId ? Number(req.body.defaultRouteId) : null;

      if (!plate) {
        return res.status(400).json({ error: 'Valid plate number is required (e.g., AA-3-A45219).' });
      }
      if (!driverPhone || driverName.length < 2) {
        return res.status(400).json({
          error: 'Driver full name and valid Ethiopian phone number (+251...) are required.',
        });
      }

      const created = await withTransaction(async (client) => {
        // 1. Find or create the driver user account by phone number
        let userRes = await client.query(
          'SELECT id, full_name, phone_number FROM users WHERE phone_number = $1 LIMIT 1',
          [driverPhone]
        );

        let driverUser;
        if (userRes.rows.length > 0) {
          driverUser = userRes.rows[0];
        } else {
          const newUser = await client.query(
            `INSERT INTO users (phone_number, full_name, role)
             VALUES ($1, $2, 'DRIVER')
             RETURNING id, full_name, phone_number`,
            [driverPhone, driverName]
          );
          driverUser = newUser.rows[0];
        }

        // 2. Insert the new taxi and generate its unique QR token
        const taxiRes = await client.query(
          `INSERT INTO taxis (plate_number, driver_user_id, default_route_id)
           VALUES ($1, $2, $3)
           RETURNING id, plate_number, driver_user_id, default_route_id, qr_token, status, created_at`,
          [plate, driverUser.id, defaultRouteId]
        );

        return {
          taxi: taxiRes.rows[0],
          driver: driverUser,
        };
      });

      return res.status(201).json(created);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'A taxi with this plate number is already registered.' });
      }
      console.error('[POST /api/stations/taxis Error]:', err);
      return res.status(500).json({ error: 'Failed to register taxi.' });
    }
  }
);

export default router;