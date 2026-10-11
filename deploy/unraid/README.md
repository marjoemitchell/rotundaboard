# Self-hosted hearing transcription (Unraid + NVIDIA GPU)

Runs the hearing transcription job on your own GPU instead of paying OpenAI
per hearing. Two containers:

- **whisperx** (`transcriber/`): WhisperX on the GPU. It does speech
  recognition, word alignment, and pyannote speaker diarization over the whole
  recording. It's only reachable from the other container, not the network.
- **transcribe-job** (`server/`): the same `npm run transcribe-hearings` job
  Railway runs. It finds new hearings, sends their audio to `whisperx`, has
  Claude name the speakers, and writes transcripts to the production database.

All connections are outbound, so nothing on the box is exposed to the
internet. The Railway `cron-transcribe-hearings` service stays deployed as a
fallback. It only pays for OpenAI when this box hasn't checked in for 6 hours.

Built for a GTX 1660 Super (6 GB). Any NVIDIA card with ≥6 GB VRAM and
compute capability ≥7.5 should work.

## One-time setup

1. **NVIDIA driver.** Install the *Nvidia Driver* plugin from Community
   Applications and pick a driver **≥ 570** (the image uses CUDA 12.8).
   Reboot, then check `nvidia-smi` in the Unraid terminal lists the card.
2. **Docker Compose.** Install the *Docker Compose Manager* plugin, or use
   `docker compose` from the terminal if you already have it.
3. **Hugging Face token** for the speaker-diarization model:
   - Create a free account and a *read* token at https://huggingface.co/settings/tokens.
   - While logged in, open https://huggingface.co/pyannote/speaker-diarization-community-1
     and accept its terms. Without this, the model download fails with a 403.
4. **Database URL.** In Railway, open the `db` service → Variables and copy
   `DATABASE_PUBLIC_URL`. That's the TCP-proxy address reachable from outside
   Railway; plain `DATABASE_URL` only works inside Railway's network.
5. **Get the code onto the box**, e.g. `git clone` into
   `/mnt/user/appdata/rotundaboard`, then:

   ```sh
   cd /mnt/user/appdata/rotundaboard/deploy/unraid
   cp .env.example .env    # fill in DATABASE_URL, ANTHROPIC_API_KEY, HF_TOKEN
   docker compose up -d --build
   ```

   The first build downloads ~6 GB (the CUDA base image plus PyTorch). The
   first transcription also downloads ~5 GB of model weights into
   `MODELS_DIR`. Both are cached after that.

## Checking it works

```sh
# GPU visible and models loadable? Should print "ok": true and your GPU name.
docker compose exec whisperx curl -s localhost:8000/health

# Job progress: discovery, captions, then per-hearing whisperx stages.
docker compose logs -f transcribe-job
```

A healthy run logs `N recording(s) to diarize this run (whisperx).`, then
`whisperx: transcribing → aligning → diarizing → done`, then
`diarized: … segments, … speakers (… named)`. The hearing's page in the app
switches from "Captions only" to "Speaker-attributed transcript".

To do one hearing first while tuning:

```sh
docker compose exec transcribe-job npm run transcribe-hearings -- --limit=1
```

## Tuning

- **Too slow?** Set `WHISPER_MODEL=large-v3-turbo` in `.env`. It's roughly
  3–4× faster for a small accuracy cost. Then `docker compose up -d`.
- **Garbage or empty text?** GTX 16-series cards have known half-precision
  quirks. Try `COMPUTE_TYPE=int8`, then `float32`.
- **CUDA out of memory?** Lower `BATCH_SIZE` to 4 (or 2).
- **Backlog.** By default each run covers hearings from the last 60 days and
  transcribes at most `DIARIZE_LIMIT` (2) before pausing `INTERVAL_SECONDS`
  (30 min). To go further back:
  `docker compose exec transcribe-job npm run transcribe-hearings -- --since=2026-01-01 --limit=20`.

## How the Railway fallback decides

Each run where `whisperx` passes its health check, the job writes a heartbeat
to `job_heartbeats`. The Railway cron runs with `--fallback-after-hours=6`. If
the heartbeat is fresher than that, it only discovers recordings and loads
captions. If the box is off, the GPU is unavailable, or the service is
failing its health check for 6 hours, Railway transcribes with OpenAI (if
`OPENAI_API_KEY` is set there) until the box checks in again. Leave
`OPENAI_API_KEY` unset on Railway to disable the paid fallback entirely.
