-- Idempotent seed of major Addis Ababa taxi hubs (run in phpMyAdmin on korchacom_db)
INSERT INTO teraye_stations (name_am, name_en, sub_city)
SELECT 'አውቶቡስ ተራ', 'Autobus Tera', 'Addis Ketema'
WHERE NOT EXISTS (SELECT 1 FROM teraye_stations WHERE name_am = 'አውቶቡስ ተራ');

INSERT INTO teraye_stations (name_am, name_en, sub_city)
SELECT 'አደይ አበባ', 'Adey Abeba', 'Bole'
WHERE NOT EXISTS (SELECT 1 FROM teraye_stations WHERE name_am = 'አደይ አበባ');

INSERT INTO teraye_stations (name_am, name_en, sub_city)
SELECT 'ኃይሌ ጋርመንት', 'Haile Garment', 'Nifas Silk-Lafto'
WHERE NOT EXISTS (SELECT 1 FROM teraye_stations WHERE name_am = 'ኃይሌ ጋርመንት');

INSERT INTO teraye_stations (name_am, name_en, sub_city)
SELECT 'ቃሊቲ', 'Kaliti', 'Akaki Kality'
WHERE NOT EXISTS (SELECT 1 FROM teraye_stations WHERE name_am = 'ቃሊቲ');

INSERT INTO teraye_stations (name_am, name_en, sub_city)
SELECT 'አራት ኪሎ', 'Arat Kilo', 'Arada'
WHERE NOT EXISTS (SELECT 1 FROM teraye_stations WHERE name_am = 'አራት ኪሎ');

INSERT INTO teraye_stations (name_am, name_en, sub_city)
SELECT 'ጉራራ', 'Gurara', 'Yeka'
WHERE NOT EXISTS (SELECT 1 FROM teraye_stations WHERE name_am = 'ጉራራ');

INSERT INTO teraye_stations (name_am, name_en, sub_city)
SELECT 'ፈረንሳይ ኬላ', 'Ferensay Kela', 'Yeka'
WHERE NOT EXISTS (SELECT 1 FROM teraye_stations WHERE name_am = 'ፈረንሳይ ኬላ');

INSERT INTO teraye_stations (name_am, name_en, sub_city)
SELECT 'ፒያሳ', 'Piazza', 'Arada'
WHERE NOT EXISTS (SELECT 1 FROM teraye_stations WHERE name_am = 'ፒያሳ');

INSERT INTO teraye_stations (name_am, name_en, sub_city)
SELECT 'መድኃኔዓለም', 'Medhanialem', 'Bole'
WHERE NOT EXISTS (SELECT 1 FROM teraye_stations WHERE name_am = 'መድኃኔዓለም');

INSERT INTO teraye_stations (name_am, name_en, sub_city)
SELECT 'ቦሌ መድኃኔዓለም', 'Bole Medhanialem', 'Bole'
WHERE NOT EXISTS (SELECT 1 FROM teraye_stations WHERE name_am = 'ቦሌ መድኃኔዓለም');

INSERT INTO teraye_stations (name_am, name_en, sub_city)
SELECT 'ቦሌ ብራስ', 'Bole Brass', 'Bole'
WHERE NOT EXISTS (SELECT 1 FROM teraye_stations WHERE name_am = 'ቦሌ ብራስ');

INSERT INTO teraye_stations (name_am, name_en, sub_city)
SELECT 'ካዛንቺስ', 'Kazanchis', 'Kirkos'
WHERE NOT EXISTS (SELECT 1 FROM teraye_stations WHERE name_am = 'ካዛንቺስ');

INSERT INTO teraye_stations (name_am, name_en, sub_city)
SELECT 'ወሎ ሰፈር', 'Wollo Sefer', 'Kirkos'
WHERE NOT EXISTS (SELECT 1 FROM teraye_stations WHERE name_am = 'ወሎ ሰፈር');

INSERT INTO teraye_stations (name_am, name_en, sub_city)
SELECT 'አጎና', 'Agona', 'Kirkos'
WHERE NOT EXISTS (SELECT 1 FROM teraye_stations WHERE name_am = 'አጎና');

INSERT INTO teraye_stations (name_am, name_en, sub_city)
SELECT 'ቄራ', 'Kera', 'Kirkos'
WHERE NOT EXISTS (SELECT 1 FROM teraye_stations WHERE name_am = 'ቄራ');
