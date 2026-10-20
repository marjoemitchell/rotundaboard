-- Many queries get the latest status of each bill:
--   SELECT ... FROM bill_statuses WHERE draft_id = $1 ORDER BY occurred_at DESC LIMIT 1
-- With this index, each lookup reads one index entry and does not sort.
-- The session bill list (4,495 bills) went from 530 ms to 125 ms.
CREATE INDEX idx_bill_statuses_draft_latest ON bill_statuses (draft_id, occurred_at DESC);
