-- Each caller has their own Twilio "from" number (the number leads see on caller ID).
-- Falls back to TWILIO_PHONE_NUMBER env var if null.
alter table users_meta
  add column if not exists twilio_from_number text;

comment on column users_meta.twilio_from_number is 'Twilio phone number this caller places calls from (E.164). Overrides TWILIO_PHONE_NUMBER env var.';
