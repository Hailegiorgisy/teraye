INSERT IGNORE INTO teraye_stations (id, name_am, name_en, sub_city) VALUES
    (1, 'መገናኛ', 'Megenagna', 'Yeka'),
    (2, 'ሜክሲኮ', 'Mexico', 'Lideta'),
    (3, 'ፒያሳ', 'Piazza', 'Arada');

INSERT IGNORE INTO teraye_routes (origin_station_id, destination_am, destination_en, route_code) VALUES
    (1, 'ቦሌ መድኃኔዓለም', 'Bole Medhanialem', 'MEG-BOL'),
    (1, 'ሲኤምሲ / ሰሚት', 'CMC / Summit', 'MEG-CMC'),
    (1, 'ፒያሳ', 'Piazza', 'MEG-PIA'),
    (2, 'መገናኛ', 'Megenagna', 'MEX-MEG'),
    (2, 'ሳሪስ / ቃሊቲ', 'Saris / Kaliti', 'MEX-SAR'),
    (3, 'ቦሌ', 'Bole', 'PIA-BOL');

-- Replace 123456789 and +251911000000 with your real Telegram ID and phone number
INSERT INTO teraye_users (id, telegram_id, phone_number, full_name, role, assigned_station_id)
VALUES (UUID(), 123456789, '+251911000000', 'System Admin', 'ADMIN', 1)
ON DUPLICATE KEY UPDATE role = 'ADMIN', assigned_station_id = 1;