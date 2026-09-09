-- Digests (generate-and-archive recaps) never grew the email-delivery layer
-- that would have made the standalone page worth it — see the comment in
-- 013_digests.sql, which always framed this as "sending is a later phase
-- once the content itself proves useful." It didn't. Replaced by a single
-- "Send this brief" action that emails the live dashboard brief (getBrief)
-- directly — nothing is generated or archived anymore.
DROP TABLE digests;
