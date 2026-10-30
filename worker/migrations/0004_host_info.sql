-- Server hardware identity (CPU model / core count), reported by the agent in
-- the `host` envelope of every report. Static facts, so unlike `latest` they
-- live in one JSON column that is only overwritten when the agent sends new
-- values. NULL until the first report that carries them.
ALTER TABLE nodes ADD COLUMN host_info TEXT;
