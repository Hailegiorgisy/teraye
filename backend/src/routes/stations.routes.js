import crypto from 'crypto';
import { Router } from 'express';
import { query, withTransaction } from '../config/db.js';
import {
  requireAuth,
  requireRegisteredUser,
  requireRole,
} from '../middleware/auth.js';

const router = Router();

function normalizePlate(raw) {
  if (!raw) return null;
  return String(raw).trim().toUpperCase().replace(/\s+/g, '-');
}

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
 */
router.get('/', async (req, res) => {
  try {
    const stationsRes = await query(
      `SELECT id, name_am, name_en, sub_city
       FROM teraye_stations
       WHERE is_active = TRUE
       ORDER BY id ASC`
    );

    const routesRes = await query(
      `SELECT id, origin_station_id, destination_am, destination_en, route_code
       FROM teraye_routes
       WHERE is_active = TRUE
       ORDER BY id ASC`
    );

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
    return res.status(500).json({ error: 'መናኸሪያዎችን መጫን አልተቻለም።' });
  }
});

/**
 * 2. POST /api/stations (ADMIN & WORKER/Marshal can add hubs)
 */
router.post(
  '/',
  requireAuth,
  requireRegisteredUser,
  requireRole('ADMIN', 'WORKER'),
  async (req, res) => {
    try {
      const nameAm = String(req.body.nameAm || '').trim();
      const nameEn = String(req.body.nameEn || '').trim() || nameAm;
      const subCity = String(req.body.subCity || '').trim() || null;

      if (!nameAm) {
        return res
          .status(400)
          .json({ error: 'የመናኸሪያው ስም በአማርኛ ያስፈልጋል።' });
      }

      const { rows: insertInfo } = await query(
        `INSERT INTO teraye_stations (name_am, name_en, sub_city)
         VALUES (?, ?, ?)`,
        [nameAm, nameEn, subCity]
      );

      const stationRes = await query(
        'SELECT id, name_am, name_en, sub_city, is_active FROM teraye_stations WHERE id = ? LIMIT 1',
        [insertInfo.insertId]
      );

      return res.status(201).json({ station: stationRes.rows[0] });
    } catch (err) {
      console.error('[POST /api/stations Error]:', err);
      return res.status(500).json({ error: 'መናኸሪያ መጨመር አልተቻለም።' });
    }
  }
);

/**
 * 3. POST /api/stations/:stationId/routes (ADMIN & WORKER/Marshal can add routes)
 */
router.post(
  '/:stationId/routes',
  requireAuth,
  requireRegisteredUser,
  requireRole('ADMIN', 'WORKER'),
  async (req, res) => {
    try {
      const stationId = Number(req.params.stationId);
      const destinationAm = String(req.body.destinationAm || '').trim();
      const destinationEn = String(req.body.destinationEn || '').trim() || destinationAm;
      const rawCode = String(req.body.routeCode || '').trim().toUpperCase();
      const routeCode = rawCode || `ST${stationId}-${Date.now().toString(36).toUpperCase()}`;

      if (!stationId || !destinationAm) {
        return res.status(400).json({
          error: 'መናኸሪያ እና የመድረሻ መስመር ስም በአማርኛ ያስፈልጋሉ።',
        });
      }

      const { rows: insertInfo } = await query(
        `INSERT INTO teraye_routes (origin_station_id, destination_am, destination_en, route_code)
         VALUES (?, ?, ?, ?)`,
        [stationId, destinationAm, destinationEn, routeCode]
      );

      const routeRes = await query(
        'SELECT id, origin_station_id, destination_am, destination_en, route_code, is_active FROM teraye_routes WHERE id = ? LIMIT 1',
        [insertInfo.insertId]
      );

      return res.status(201).json({ route: routeRes.rows[0] });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'ይህ የመስመር ኮድ ቀድሞ ተመዝግቧል።' });
      }
      console.error('[POST /api/stations/:stationId/routes Error]:', err);
      return res.status(500).json({ error: 'መስመር መጨመር አልተቻለም።' });
    }
  }
);

/**
 * 4. GET /api/stations/taxis/search?q=45219  OR  ?qrToken=<uuid>
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
           FROM teraye_taxis t
           LEFT JOIN teraye_users u ON u.id = t.driver_user_id
           LEFT JOIN teraye_routes r ON r.id = t.default_route_id
           WHERE t.qr_token = ?
           LIMIT 1`,
          [qrToken]
        );
        return res.json({ taxis: qrRes.rows });
      }

      if (q.length < 2) {
        return res.status(400).json({ error: 'ቢያንስ 2 የታርጋ ፊደላት/ቁጥሮች ያስገቡ።' });
      }

      const searchRes = await query(
        `SELECT t.id, t.plate_number, t.default_route_id, t.qr_token, t.status,
                u.full_name AS driver_name, u.phone_number AS driver_phone,
                r.destination_am, r.destination_en, r.route_code
         FROM teraye_taxis t
         LEFT JOIN teraye_users u ON u.id = t.driver_user_id
         LEFT JOIN teraye_routes r ON r.id = t.default_route_id
         WHERE t.plate_number LIKE ?
         ORDER BY t.plate_number ASC
         LIMIT 20`,
        [`%${q}%`]
      );

      return res.json({ taxis: searchRes.rows });
    } catch (err) {
      console.error('[GET /api/stations/taxis/search Error]:', err);
      return res.status(500).json({ error: 'ታክሲ መፈለግ አልተቻለም።' });
    }
  }
);

/**
 * 5. POST /api/stations/taxis
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
        return res.status(400).json({ error: 'ትክክለኛ የታርጋ ቁጥር ያስገቡ (ለምሳሌ AA-3-A45219)።' });
      }
      if (!driverPhone || driverName.length < 2) {
        return res.status(400).json({
          error: 'የሹፌሩ ሙሉ ስም እና የኢትዮጵያ ስልክ ቁጥር (+251...) ያስፈልጋል።',
        });
      }

      const created = await withTransaction(async (client) => {
        const userRes = await client.query(
          'SELECT id, full_name, phone_number FROM teraye_users WHERE phone_number = ? LIMIT 1',
          [driverPhone]
        );

        let driverUser;
        if (userRes.rows.length > 0) {
          driverUser = userRes.rows[0];
        } else {
          const newUserId = crypto.randomUUID();
          await client.query(
            `INSERT INTO teraye_users (id, phone_number, full_name, role)
             VALUES (?, ?, ?, 'DRIVER')`,
            [newUserId, driverPhone, driverName]
          );
          driverUser = { id: newUserId, full_name: driverName, phone_number: driverPhone };
        }

        const newTaxiId = crypto.randomUUID();
        const newQrToken = crypto.randomUUID();
        await client.query(
          `INSERT INTO teraye_taxis (id, plate_number, driver_user_id, default_route_id, qr_token)
           VALUES (?, ?, ?, ?, ?)`,
          [newTaxiId, plate, driverUser.id, defaultRouteId, newQrToken]
        );

        const taxiRes = await client.query(
          'SELECT id, plate_number, driver_user_id, default_route_id, qr_token, status, created_at FROM teraye_taxis WHERE id = ? LIMIT 1',
          [newTaxiId]
        );

        return {
          taxi: taxiRes.rows[0],
          driver: driverUser,
        };
      });

      return res.status(201).json(created);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'ይህ የታርጋ ቁጥር ቀድሞ ተመዝግቧል።' });
      }
      console.error('[POST /api/stations/taxis Error]:', err);
      return res.status(500).json({ error: 'ታክሲ መመዝገብ አልተቻለም።' });
    }
  }
);

export default router;
