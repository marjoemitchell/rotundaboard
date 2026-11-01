-- Migration 035 removed the "+" tag from every address. Many providers do not
-- use "+" tags, so "a+b@example.com" can be the inbox of a different person.
-- This index removes the "+" tag only for the providers in PLUS_TAG_DOMAINS.
-- It removes dots only for Gmail. The expression is the same as
-- emailInboxKeySql('email') in server/src/auth/emailAddress.ts.
-- The new key is never less specific than the old key, so no current rows conflict.
DROP INDEX users_email_inbox_key;
CREATE UNIQUE INDEX users_email_inbox_key ON users ((
  ((CASE WHEN (CASE split_part(email, '@', 2) WHEN 'googlemail.com' THEN 'gmail.com' ELSE split_part(email, '@', 2) END) IN ('gmail.com') THEN replace((CASE WHEN (CASE split_part(email, '@', 2) WHEN 'googlemail.com' THEN 'gmail.com' ELSE split_part(email, '@', 2) END) IN ('gmail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'fastmail.com', 'fastmail.fm', 'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me') THEN split_part(split_part(email, '@', 1), '+', 1) ELSE split_part(email, '@', 1) END), '.', '') ELSE (CASE WHEN (CASE split_part(email, '@', 2) WHEN 'googlemail.com' THEN 'gmail.com' ELSE split_part(email, '@', 2) END) IN ('gmail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'fastmail.com', 'fastmail.fm', 'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me') THEN split_part(split_part(email, '@', 1), '+', 1) ELSE split_part(email, '@', 1) END) END) || '@' || (CASE split_part(email, '@', 2) WHEN 'googlemail.com' THEN 'gmail.com' ELSE split_part(email, '@', 2) END))
));
