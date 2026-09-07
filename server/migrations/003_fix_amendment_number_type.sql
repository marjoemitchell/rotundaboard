-- amendmentNumber on a vote is not always numeric (e.g. "SB0114.001.001" —
-- an amendment document number, not an ordinal) despite looking numeric in
-- early samples. Discovered via a failed batch: 6 of 1759 bills errored with
-- "invalid input syntax for type integer" on this column.
ALTER TABLE bill_votes ALTER COLUMN amendment_number TYPE TEXT;
