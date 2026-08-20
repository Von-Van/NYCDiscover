CREATE TABLE IF NOT EXISTS provider_cache (
    cache_key TEXT PRIMARY KEY,
    payload JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    stale_until TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS provider_cache_stale_until_idx ON provider_cache (stale_until);

CREATE TABLE IF NOT EXISTS provider_throttle (
    provider TEXT PRIMARY KEY,
    next_allowed_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS api_rate_limits (
    bucket_key TEXT PRIMARY KEY,
    request_count INTEGER NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS api_rate_limits_expires_at_idx ON api_rate_limits (expires_at);

CREATE TABLE IF NOT EXISTS shared_itineraries (
    share_id TEXT PRIMARY KEY,
    brief JSONB NOT NULL,
    generation JSONB NOT NULL,
    selected_plan_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS shared_itineraries_expires_at_idx ON shared_itineraries (expires_at);
