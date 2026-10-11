-- Archived committee hearing recordings and their transcripts. Recordings
-- are discovered on the Legislature's Nomad Media video archive
-- (streaming-video.legmt.gov / streaming-api.legmt.gov — NOT SliQ Harmony,
-- which the state no longer uses), matched to our scraped interim-committee
-- meetings by committee + date, then transcribed by
-- src/transcribeHearings.ts in two passes:
--
--   1. 'captions'  — Nomad's own live-caption .vtt, ingested as soon as the
--                    video is posted. Free and immediate, but lossy (~1/3 of
--                    words) with no speaker labels. transcript_status
--                    'processing'.
--   2. 'diarized'  — our own Whisper-family transcription with speaker
--                    diarization, speakers then matched to legislators by
--                    Claude. Replaces the caption segments. transcript_status
--                    'ready'.
--
-- 'failed' means the diarized pass gave up after repeated errors; whatever
-- caption segments exist are kept so the hearing still has something.
CREATE TABLE hearing_recordings (
  id SERIAL PRIMARY KEY,
  nomad_item_id TEXT NOT NULL UNIQUE,
  committee_id INTEGER REFERENCES non_standing_committees(id) ON DELETE SET NULL,
  -- Nullable: a recording can exist for a meeting our scraped schedule
  -- doesn't have (or the archive's date/time disagrees with it). Not unique:
  -- one meeting can be split across a morning and an afternoon recording.
  meeting_id INTEGER REFERENCES non_standing_committee_meetings(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  committee_name TEXT NOT NULL,
  -- Naive Mountain wall-clock time parsed from the archive's title, same
  -- convention as every other scraped TIMESTAMP column (see db.ts).
  recorded_at TIMESTAMP NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  hls_url TEXT NOT NULL,
  -- The audio-only rendition of hls_url; what the pipeline downloads and
  -- what the API's audio proxy serves to the browser player.
  audio_playlist_url TEXT,
  caption_url TEXT,
  transcript_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (transcript_status IN ('pending', 'processing', 'ready', 'failed')),
  transcript_source TEXT CHECK (transcript_source IN ('captions', 'diarized')),
  waveform JSONB NOT NULL DEFAULT '[]',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  transcribed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_hearing_recordings_recorded_at ON hearing_recordings(recorded_at DESC);
CREATE INDEX idx_hearing_recordings_meeting ON hearing_recordings(meeting_id);
CREATE INDEX idx_hearing_recordings_committee ON hearing_recordings(committee_id);

-- One row per diarized speaker label in a recording. legislator_id is
-- intentionally unconstrained, same reasoning as elsewhere in this schema.
-- display_name is always set (falls back to "Speaker N") so the API never
-- has to invent labels at read time.
CREATE TABLE hearing_speakers (
  recording_id INTEGER NOT NULL REFERENCES hearing_recordings(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  display_name TEXT NOT NULL,
  legislator_id INTEGER,
  role TEXT,
  confidence REAL,
  PRIMARY KEY (recording_id, label)
);

CREATE TABLE hearing_transcript_segments (
  recording_id INTEGER NOT NULL REFERENCES hearing_recordings(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  start_seconds REAL NOT NULL,
  end_seconds REAL NOT NULL,
  -- NULL for caption-sourced segments (no diarization yet).
  speaker_label TEXT,
  text TEXT NOT NULL,
  PRIMARY KEY (recording_id, seq)
);
