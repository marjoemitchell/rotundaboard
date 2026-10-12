-- Before this change, scrape_health_alerts recorded an alert before the
-- email was sent. If the send failed (for example, MAINTAINER_EMAIL was not
-- set yet), the alert was recorded but not sent, and later runs with the
-- same problem sent nothing. Delete the records once. The next run sends
-- an alert for each current problem.
DELETE FROM scrape_health_alerts;
