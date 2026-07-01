-- Initial SmartBox schema
-- Run: sqlx migrate run

CREATE TABLE IF NOT EXISTS hosts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL DEFAULT 22,
    username VARCHAR(64) NOT NULL,
    auth_type VARCHAR(16) NOT NULL DEFAULT 'password',
    encrypted_password TEXT,
    encrypted_private_key TEXT,
    group_name VARCHAR(64) DEFAULT '',
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    command TEXT NOT NULL,
    group_name VARCHAR(64) DEFAULT '',
    description TEXT DEFAULT '',
    is_favorite BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plugins (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    version VARCHAR(32) NOT NULL,
    description TEXT DEFAULT '',
    author VARCHAR(128) DEFAULT '',
    icon VARCHAR(64) DEFAULT '',
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hosts_host ON hosts(host);
CREATE INDEX IF NOT EXISTS idx_scripts_group ON scripts(group_name);
