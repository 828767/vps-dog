-- Record the source address the agent reports from.
--
-- The agent connects out from the monitored host, so `CF-Connecting-IP` on
-- `POST /api/v1/report` *is* that host's public address — no agent change and
-- no re-install needed. Empty for nodes that have never reported.
ALTER TABLE nodes ADD COLUMN ip TEXT NOT NULL DEFAULT '';
