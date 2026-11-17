CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Users (Supports both Telegram users and standalone Mobile App users)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id BIGINT UNIQUE,                 -- Nullable for Mobile-App-only users
    phone_number VARCHAR(20) UNIQUE NOT NULL,  -- Format: +2519XXXXXXXX
    pin_hash TEXT,                             -- For Mobile App login
    full_name VARCHAR(120) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'DRIVER'
        CHECK (role IN ('DRIVER', 'WORKER', 'ADMIN')),
    assigned_station_id INT,                   -- Set for WORKER (ተራ አስከባሪ)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Taxi Stations / Terminals (e.g., Megenagna, Mexico, Piazza)
CREATE TABLE stations (
    id SERIAL PRIMARY KEY,
    name_am VARCHAR(100) NOT NULL,             -- e.g., መገናኛ
    name_en VARCHAR(100) NOT NULL,             -- e.g., Megenagna
    sub_city VARCHAR(80),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users
    ADD CONSTRAINT fk_users_station
    FOREIGN KEY (assigned_station_id) REFERENCES stations(id) ON DELETE SET NULL;

-- 3. Routes departing from a station
CREATE TABLE routes (
    id SERIAL PRIMARY KEY,
    origin_station_id INT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    destination_am VARCHAR(100) NOT NULL,      -- e.g., ቦሌ መድኃኔዓለም
    destination_en VARCHAR(100) NOT NULL,      -- e.g., Bole Medhanialem
    route_code VARCHAR(30) UNIQUE NOT NULL,    -- e.g., MEG-BOL
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Taxis (Physical Minibuses)
CREATE TABLE taxis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plate_number VARCHAR(25) UNIQUE NOT NULL,  -- Normalized e.g., AA-3-A45219
    driver_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    default_route_id INT REFERENCES routes(id) ON DELETE SET NULL,
    qr_token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUSPENDED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Live & Historical Queue Entries (Core FIFO Engine)
CREATE TABLE queue_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    taxi_id UUID NOT NULL REFERENCES taxis(id) ON DELETE CASCADE,
    station_id INT NOT NULL REFERENCES stations(id),
    route_id INT NOT NULL REFERENCES routes(id), -- Trip-specific route (allows route switches)
    checked_in_by UUID REFERENCES users(id),
    arrived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'WAITING'
        CHECK (status IN ('WAITING', 'LOADING', 'DISPATCHED', 'SKIPPED', 'CANCELLED'))
);

-- Prevents a taxi from being queued in two places at the same time
CREATE UNIQUE INDEX idx_one_active_queue_per_taxi
    ON queue_entries (taxi_id)
    WHERE status IN ('WAITING', 'LOADING');

-- Fast FIFO lookup per station + route
CREATE INDEX idx_fifo_queue_lookup
    ON queue_entries (station_id, route_id, status, arrived_at ASC);

-- 6. Tamper-Evident Audit Log for Marshal Actions
CREATE TABLE queue_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    queue_entry_id UUID NOT NULL REFERENCES queue_entries(id) ON DELETE CASCADE,
    action_by UUID REFERENCES users(id),
    action_type VARCHAR(30) NOT NULL
        CHECK (action_type IN ('CHECK_IN', 'DISPATCH', 'ROUTE_CHANGE', 'SKIP', 'REQUEUE', 'CANCEL')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Runtime Settings (Mirrors / overrides .env flags)
CREATE TABLE system_settings (
    key VARCHAR(60) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value) VALUES
    ('BREAKDOWN_GRACE_MINUTES', '5'),
    ('ENABLE_PAYMENTS', 'false')
ON CONFLICT (key) DO NOTHING;