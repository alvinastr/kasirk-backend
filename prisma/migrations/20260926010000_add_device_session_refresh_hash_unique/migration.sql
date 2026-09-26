-- Refresh tokens are high-entropy opaque values. Their deterministic hashes
-- must identify exactly one device session for safe rotation and logout.
CREATE UNIQUE INDEX "uq_device_sessions_refresh_token_hash"
ON "device_sessions"("refresh_token_hash");
