-- Contact data of the legislators, from the profiles on the legmt.gov
-- WordPress site (src/scrape.ts). The bearbeta API has these fields, but
-- they are empty there.
ALTER TABLE legislators
  ADD COLUMN phone_number TEXT,
  ADD COLUMN city TEXT,
  ADD COLUMN home_county TEXT;
