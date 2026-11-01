-- One inbox gets one account. "name+other@example.com" goes to the same inbox
-- as "name@example.com", and Gmail ignores the dots before the "@". The
-- signup route checks this first (server/src/auth/emailAddress.ts). This
-- index stops two signups at the same time for one inbox. The expression is
-- the same as emailInboxKeySql('email'). The email column is lowercase.
CREATE UNIQUE INDEX users_email_inbox_key ON users ((
  CASE WHEN split_part(email, '@', 2) IN ('gmail.com', 'googlemail.com')
    THEN replace(split_part(regexp_replace(email, '\+[^@]*@', '@'), '@', 1), '.', '') || '@gmail.com'
    ELSE split_part(regexp_replace(email, '\+[^@]*@', '@'), '@', 1) || '@' || split_part(email, '@', 2)
  END
));
