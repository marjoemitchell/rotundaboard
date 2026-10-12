-- Record when the speaker names step completes for a hearing transcript.
--
-- Speaker names come from a separate Claude step after the transcription
-- (see src/identifySpeakers.ts). If that step fails, the transcript is kept
-- without names. These columns let the transcription job find those
-- transcripts and run the names step again from the stored segments, with
-- no new transcription.
ALTER TABLE hearing_recordings
  ADD COLUMN speakers_identified_at TIMESTAMPTZ,
  ADD COLUMN speaker_id_attempts INTEGER NOT NULL DEFAULT 0;

-- Transcripts that already have one or more named speakers are complete.
UPDATE hearing_recordings r
SET speakers_identified_at = coalesce(r.transcribed_at, now())
WHERE r.transcript_source = 'diarized'
  AND EXISTS (
    SELECT 1 FROM hearing_speakers sp
    WHERE sp.recording_id = r.id
      AND sp.label <> 'UNKNOWN'
      AND sp.display_name NOT LIKE 'Speaker %'
  );
