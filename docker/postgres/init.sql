-- ─────────────────────────────────────────────────────────────────
-- AI Surveillance Platform — PostgreSQL / TimescaleDB Init
-- ─────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Users ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username    VARCHAR(64) UNIQUE NOT NULL,
    email       VARCHAR(255) UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    role        VARCHAR(32) NOT NULL DEFAULT 'operator',
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Cameras / Sensors ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cameras (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(128) NOT NULL,
    location    VARCHAR(255),
    ip_address  VARCHAR(64),
    zone_config JSONB DEFAULT '{}',
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Videos ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS videos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename        VARCHAR(512) NOT NULL,
    original_name   VARCHAR(512),
    file_path       TEXT NOT NULL,
    file_size       BIGINT,
    duration_secs   FLOAT,
    fps             FLOAT,
    resolution      VARCHAR(32),
    camera_id       UUID REFERENCES cameras(id) ON DELETE SET NULL,
    status          VARCHAR(32) DEFAULT 'pending',
    progress        FLOAT DEFAULT 0.0,
    frames_total    INTEGER DEFAULT 0,
    frames_processed INTEGER DEFAULT 0,
    error_message   TEXT,
    uploaded_by     UUID REFERENCES users(id),
    uploaded_at     TIMESTAMPTZ DEFAULT NOW(),
    processed_at    TIMESTAMPTZ,
    celery_task_id  VARCHAR(255),
    metadata        JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_uploaded_at ON videos(uploaded_at DESC);

-- ── Person Registry ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS persons (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255),
    alias           VARCHAR(255),
    risk_level      VARCHAR(32) DEFAULT 'unknown',
    notes           TEXT,
    face_embedding_id VARCHAR(255),
    photo_path      TEXT,
    is_registered   BOOLEAN DEFAULT FALSE,
    registered_at   TIMESTAMPTZ,
    registered_by   UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    metadata        JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_persons_risk_level ON persons(risk_level);

-- ── Detection Events (TimescaleDB hypertable) ──────────────────────
CREATE TABLE IF NOT EXISTS events (
    id              UUID DEFAULT uuid_generate_v4(),
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    video_id        UUID REFERENCES videos(id) ON DELETE CASCADE,
    camera_id       UUID REFERENCES cameras(id) ON DELETE SET NULL,
    track_id        INTEGER,
    person_id       UUID REFERENCES persons(id) ON DELETE SET NULL,
    event_type      VARCHAR(64) NOT NULL,
    severity        VARCHAR(32) DEFAULT 'low',
    threat_score    FLOAT DEFAULT 0.0,
    confidence      FLOAT DEFAULT 0.0,
    frame_number    INTEGER,
    timestamp_secs  FLOAT,
    bbox            JSONB,
    zone_id         VARCHAR(128),
    zone_name       VARCHAR(255),
    behavior_flags  JSONB DEFAULT '[]',
    metadata        JSONB DEFAULT '{}',
    acknowledged    BOOLEAN DEFAULT FALSE,
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    PRIMARY KEY (id, timestamp)
);

SELECT create_hypertable('events', 'timestamp', if_not_exists => TRUE);
SELECT add_retention_policy('events', INTERVAL '90 days', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_events_video_id ON events(video_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_severity ON events(severity, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_track_id ON events(track_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_acknowledged ON events(acknowledged, timestamp DESC);

-- ── Alerts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id        UUID NOT NULL,
    alert_type      VARCHAR(64) NOT NULL,
    severity        VARCHAR(32) DEFAULT 'medium',
    title           VARCHAR(512),
    description     TEXT,
    threat_score    FLOAT,
    is_read         BOOLEAN DEFAULT FALSE,
    is_dismissed    BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_is_read ON alerts(is_read);

-- ── Incident Reports ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incident_reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id        UUID,
    video_id        UUID REFERENCES videos(id),
    title           VARCHAR(512),
    summary         TEXT,
    classification  VARCHAR(128),
    recommended_actions JSONB DEFAULT '[]',
    confidence_notes TEXT,
    llm_provider    VARCHAR(64),
    llm_model       VARCHAR(128),
    generated_at    TIMESTAMPTZ DEFAULT NOW(),
    generated_by    UUID REFERENCES users(id),
    docx_path       TEXT,
    metadata        JSONB DEFAULT '{}'
);

-- ── Audit Log ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp       TIMESTAMPTZ DEFAULT NOW(),
    user_id         UUID REFERENCES users(id),
    username        VARCHAR(64),
    action          VARCHAR(128) NOT NULL,
    resource_type   VARCHAR(64),
    resource_id     VARCHAR(255),
    ip_address      VARCHAR(64),
    user_agent      TEXT,
    status_code     INTEGER,
    duration_ms     INTEGER,
    trace_id        VARCHAR(64),
    metadata        JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, timestamp DESC);

-- ── Default Admin User ────────────────────────────────────────────
-- Password: Admin@1234 (bcrypt hashed — change immediately in production)
INSERT INTO users (username, email, hashed_password, role)
VALUES (
    'admin',
    'admin@surveillance.local',
    '$2b$12$tq3hk5gzawaseOGc4lf2E.zKrzQ7tWCxEsZqySC2ZZIfGvtlvZIK2',
    'admin'
) ON CONFLICT (username) DO NOTHING;
