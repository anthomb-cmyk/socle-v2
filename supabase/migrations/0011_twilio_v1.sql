-- ════════════════════════════════════════════════════════════════════════
-- Twilio P1 support columns on call_logs
-- ════════════════════════════════════════════════════════════════════════
--
-- recording_sid      : Twilio RecordingSid — needed to auth-download the MP3
-- transcript_status  : tracks pipeline state ('none'|'pending_recording'|
--                      'processing'|'completed'|'failed'|'disabled')
-- parent_call_sid    : the outbound bridge creates two legs:
--                        parent = call to caller's cell phone
--                        child  = bridged call to the lead
--                      twilio_call_sid holds the parent SID; we track the
--                      child SID here so we can correlate webhook events
--                      that arrive for the inner leg.

alter table call_logs
  add column if not exists recording_sid     text,
  add column if not exists transcript_status text not null default 'none',
  add column if not exists parent_call_sid   text;

comment on column call_logs.recording_sid     is 'Twilio RecordingSid for authenticated MP3 download.';
comment on column call_logs.transcript_status is 'none | pending_recording | processing | completed | failed | disabled';
comment on column call_logs.parent_call_sid   is 'Outer-leg call SID (caller phone). twilio_call_sid is the parent; this tracks the inner (lead) leg if needed.';
