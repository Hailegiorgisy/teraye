-- Teraye MySQL / MariaDB Schema (Matches backend/sql/002_seed.sql & Node.js routes)

-- 1. Taxi Stations / Terminals (e.g., Megenagna, Mexico, Piazza)
CREATE TABLE IF NOT EXISTS teraye_stations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name_am VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    sub_city VARCHAR(80),
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Users (Supports both Telegram users and standalone Mobile App users)
CREATE TABLE IF NOT EXISTS teraye_users (
    id CHAR(36) PRIMARY KEY,
    telegram_id BIGINT UNIQUE,
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    pin_hash TEXT,
    reset_otp_hash VARCHAR(255) NULL,
    reset_otp_expires_at DATETIME NULL,
    full_name VARCHAR(120) NOT NULL,
    role ENUM('DRIVER', 'WORKER', 'ADMIN') NOT NULL DEFAULT 'DRIVER',
    assigned_station_id INT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_teraye_users_station
        FOREIGN KEY (assigned_station_id) REFERENCES teraye_stations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Routes departing from a station
CREATE TABLE IF NOT EXISTS teraye_routes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    origin_station_id INT NOT NULL,
    destination_am VARCHAR(100) NOT NULL,
    destination_en VARCHAR(100) NOT NULL,
    route_code VARCHAR(30) UNIQUE NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_teraye_routes_station
        FOREIGN KEY (origin_station_id) REFERENCES teraye_stations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Taxis (Physical Minibuses)
CREATE TABLE IF NOT EXISTS teraye_taxis (
    id CHAR(36) PRIMARY KEY,
    plate_number VARCHAR(25) UNIQUE NOT NULL,
    driver_user_id CHAR(36) NULL,
    default_route_id INT NULL,
    qr_token CHAR(36) UNIQUE NOT NULL,
    status ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_teraye_taxis_driver
        FOREIGN KEY (driver_user_id) REFERENCES teraye_users(id) ON DELETE SET NULL,
    CONSTRAINT fk_teraye_taxis_route
        FOREIGN KEY (default_route_id) REFERENCES teraye_routes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Live & Historical Queue Entries (Core FIFO Engine)
CREATE TABLE IF NOT EXISTS teraye_queue_entries (
    id CHAR(36) PRIMARY KEY,
    taxi_id CHAR(36) NOT NULL,
    station_id INT NOT NULL,
    route_id INT NOT NULL,
    checked_in_by CHAR(36) NULL,
    arrived_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dispatched_at DATETIME NULL,
    status ENUM('WAITING', 'LOADING', 'DISPATCHED', 'SKIPPED', 'CANCELLED') NOT NULL DEFAULT 'WAITING',
    INDEX idx_fifo_queue_lookup (station_id, route_id, status, arrived_at),
    CONSTRAINT fk_teraye_queue_taxi
        FOREIGN KEY (taxi_id) REFERENCES teraye_taxis(id) ON DELETE CASCADE,
    CONSTRAINT fk_teraye_queue_station
        FOREIGN KEY (station_id) REFERENCES teraye_stations(id),
    CONSTRAINT fk_teraye_queue_route
        FOREIGN KEY (route_id) REFERENCES teraye_routes(id),
    CONSTRAINT fk_teraye_queue_checked_in_by
        FOREIGN KEY (checked_in_by) REFERENCES teraye_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Tamper-Evident Audit Log for Marshal Actions
CREATE TABLE IF NOT EXISTS teraye_queue_audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    queue_entry_id CHAR(36) NOT NULL,
    action_by CHAR(36) NULL,
    action_type ENUM('CHECK_IN', 'DISPATCH', 'ROUTE_CHANGE', 'SKIP', 'REQUEUE', 'CANCEL') NOT NULL,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_teraye_audit_entry
        FOREIGN KEY (queue_entry_id) REFERENCES teraye_queue_entries(id) ON DELETE CASCADE,
    CONSTRAINT fk_teraye_audit_user
        FOREIGN KEY (action_by) REFERENCES teraye_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Runtime Settings (Mirrors / overrides .env flags)
CREATE TABLE IF NOT EXISTS teraye_system_settings (
    `key` VARCHAR(60) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO teraye_system_settings (`key`, value) VALUES
    ('BREAKDOWN_GRACE_MINUTES', '5'),
    ('ENABLE_PAYMENTS', 'false');
