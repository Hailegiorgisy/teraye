-- 1. Seed Initial Addis Ababa Taxi Terminals
INSERT INTO stations (id, name_am, name_en, sub_city) VALUES
    (1, 'መገናኛ', 'Megenagna', 'Yeka'),
    (2, 'ሜክሲኮ', 'Mexico', 'Lideta'),
    (3, 'ፒያሳ', 'Piazza', 'Arada')
ON CONFLICT (id) DO NOTHING;

-- Reset serial sequence so future admin-created stations get IDs 4+
SELECT setval('stations_id_seq', COALESCE((SELECT MAX(id) FROM stations), 1));

-- 2. Seed Active Corridors (Routes)
INSERT INTO routes (origin_station_id, destination_am, destination_en, route_code) VALUES
    (1, 'ቦሌ መድኃኔዓለም', 'Bole Medhanialem', 'MEG-BOL'),
    (1, 'ሲኤምሲ / ሰሚት', 'CMC / Summit', 'MEG-CMC'),
    (1, 'ፒያሳ', 'Piazza', 'MEG-PIA'),
    (2, 'መገናኛ', 'Megenagna', 'MEX-MEG'),
    (2, 'ሳሪስ / ቃሊቲ', 'Saris / Kaliti', 'MEX-SAR'),
    (3, 'ቦሌ', 'Bole', 'PIA-BOL')
ON CONFLICT (route_code) DO NOTHING;

-- 3. Create Your First Operator Admin / Marshal Account
-- Replace +251911000000 and 123456789 with your real phone & Telegram ID
INSERT INTO users (telegram_id, phone_number, full_name, role, assigned_station_id)
VALUES (
    123456789,
    '+251911000000',
    'System Admin',
    'ADMIN',
    1
)
ON CONFLICT (phone_number) DO UPDATE
SET role = 'ADMIN', assigned_station_id = 1;