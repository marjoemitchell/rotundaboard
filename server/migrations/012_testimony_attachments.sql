-- Lets a testimony record carry an already-written document (a PDF or DOCX
-- drafted outside the tool) instead of requiring the text to be retyped into
-- the body field. Stored directly in Postgres rather than a separate object
-- store or filesystem volume — nothing else in this app needs blob storage,
-- volumes aren't part of the deploy story yet, and at this org's scale
-- (a handful of documents, each a few hundred KB to a couple MB) an extra
-- storage system isn't worth the operational overhead.

ALTER TABLE testimony
  ADD COLUMN attachment_filename TEXT,
  ADD COLUMN attachment_mime_type TEXT,
  ADD COLUMN attachment_data BYTEA;
