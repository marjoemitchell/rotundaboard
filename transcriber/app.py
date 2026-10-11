"""WhisperX transcription service for Rotunda Board hearing recordings.

Runs on a GPU host (an Unraid box with a GTX 1660 Super, in our case) next
to the transcribe-hearings job, which calls it instead of OpenAI when
TRANSCRIBE_BACKEND=whisperx (see server/src/diarizeWhisperX.ts).

Pipeline per job: faster-whisper ASR (WhisperX batched, VAD-segmented) ->
wav2vec2 word alignment -> pyannote speaker diarization over the WHOLE
recording -> words assigned to speakers -> segments split wherever the
speaker changes. One job runs at a time; each model is loaded for its stage
and freed before the next, so the three fit in 6 GB of VRAM.

Jobs are asynchronous because a multi-hour hearing takes a while:
    POST   /jobs          multipart: file, prompt?, min_speakers?, max_speakers?  -> 202 {id}
    GET    /jobs/{id}     -> {status: queued|running|done|failed, stage, error, result}
    DELETE /jobs/{id}
    GET    /health        -> device/model info; 503 if the GPU isn't usable
Job state is in memory: if the container restarts mid-job, the caller sees
404 for that id and retries on its next run.
"""

import gc
import logging
import os
import queue
import shutil
import tempfile
import threading
import time
import uuid
from typing import Optional

import torch
import whisperx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from whisperx.diarize import DiarizationPipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("transcriber")

DEVICE = os.environ.get("DEVICE", "cuda")
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "large-v3")
# int8_float16: int8 weights with fp16 compute — ~3 GB for large-v3. GTX 16xx
# cards have known fp16 quirks; if output comes back as garbage, try
# COMPUTE_TYPE=int8 or float32.
COMPUTE_TYPE = os.environ.get("COMPUTE_TYPE", "int8_float16")
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "8"))
HF_TOKEN = os.environ.get("HF_TOKEN") or None
# Debugging only: skip diarization (every segment gets speaker null).
DIARIZE = os.environ.get("DIARIZE", "1") != "0"
LANGUAGE = "en"

app = FastAPI(title="Rotunda Board transcriber")
jobs: dict[str, dict] = {}
work: "queue.Queue[str]" = queue.Queue()
jobs_lock = threading.Lock()


def free_gpu() -> None:
    gc.collect()
    if DEVICE == "cuda":
        torch.cuda.empty_cache()


def split_by_speaker(segments: list[dict]) -> list[dict]:
    """Turns WhisperX's aligned segments into speaker-homogeneous ones.

    A Whisper segment can span a speaker change (the chair cutting in, a
    quick "thank you"), so rather than trusting the segment-level majority
    speaker, cut at every change in word-level speaker. Words the aligner
    couldn't time (numerals, symbols) inherit their neighbour's speaker and
    time.
    """
    out: list[dict] = []
    for seg in segments:
        words = seg.get("words") or []
        if not words:
            text = (seg.get("text") or "").strip()
            if text:
                out.append({"start": seg["start"], "end": seg["end"], "speaker": seg.get("speaker"), "text": text})
            continue
        current: Optional[dict] = None
        last_speaker = seg.get("speaker")
        last_end = seg["start"]
        for w in words:
            speaker = w.get("speaker", last_speaker)
            start = w.get("start", last_end)
            end = w.get("end", start)
            if current is None or speaker != current["speaker"]:
                if current is not None:
                    out.append(current)
                current = {"start": start, "end": end, "speaker": speaker, "text": w["word"]}
            else:
                current["end"] = end
                current["text"] += " " + w["word"]
            last_speaker, last_end = speaker, end
        if current is not None:
            out.append(current)
    for s in out:
        s["text"] = s["text"].strip()
        s["start"] = round(float(s["start"]), 3)
        s["end"] = round(float(s["end"]), 3)
    return [s for s in out if s["text"]]


def run_job(job_id: str) -> None:
    job = jobs[job_id]
    path = job["path"]

    def stage(name: str) -> None:
        job["stage"] = name
        log.info("job %s: %s", job_id, name)

    t0 = time.time()
    try:
        stage("loading audio")
        audio = whisperx.load_audio(path)
        duration = len(audio) / 16000

        stage("transcribing")
        asr_options = {"initial_prompt": job["prompt"]} if job["prompt"] else None
        model = whisperx.load_model(
            WHISPER_MODEL, DEVICE, compute_type=COMPUTE_TYPE, language=LANGUAGE, asr_options=asr_options
        )
        result = model.transcribe(audio, batch_size=BATCH_SIZE, language=LANGUAGE)
        del model
        free_gpu()

        stage("aligning")
        align_model, metadata = whisperx.load_align_model(language_code=LANGUAGE, device=DEVICE)
        result = whisperx.align(result["segments"], align_model, metadata, audio, DEVICE, return_char_alignments=False)
        del align_model
        free_gpu()

        if DIARIZE:
            stage("diarizing")
            pipeline = DiarizationPipeline(token=HF_TOKEN, device=DEVICE)
            diarize_df = pipeline(audio, min_speakers=job["min_speakers"], max_speakers=job["max_speakers"])
            del pipeline
            free_gpu()
            result = whisperx.assign_word_speakers(diarize_df, result)

        segments = split_by_speaker(result["segments"])
        job.update(
            status="done",
            stage="done",
            result={"duration": duration, "segments": segments, "model": WHISPER_MODEL, "diarized": DIARIZE},
        )
        log.info("job %s: done — %d segments, %.0f s audio in %.0f s", job_id, len(segments), duration, time.time() - t0)
    except Exception as exc:  # noqa: BLE001 — report any failure back to the caller
        log.exception("job %s failed", job_id)
        job.update(status="failed", error=f"{type(exc).__name__}: {exc}")
    finally:
        free_gpu()
        shutil.rmtree(os.path.dirname(path), ignore_errors=True)


def worker() -> None:
    while True:
        job_id = work.get()
        if job_id in jobs:
            jobs[job_id]["status"] = "running"
            run_job(job_id)
        work.task_done()


threading.Thread(target=worker, daemon=True).start()


@app.get("/health")
def health():
    info = {
        "device": DEVICE,
        "model": WHISPER_MODEL,
        "compute_type": COMPUTE_TYPE,
        "diarize": DIARIZE,
        "queued": work.qsize(),
        "torch": torch.__version__,
    }
    problems = []
    if DEVICE == "cuda":
        if not torch.cuda.is_available():
            problems.append("CUDA is not available — check the NVIDIA driver and the container's GPU runtime")
        else:
            major, minor = torch.cuda.get_device_capability(0)
            info["gpu"] = torch.cuda.get_device_name(0)
            info["capability"] = f"sm_{major}{minor}"
            info["arch_list"] = torch.cuda.get_arch_list()
            if f"sm_{major}{minor}" not in info["arch_list"]:
                problems.append(f"this torch build has no kernels for {info['capability']}")
    if DIARIZE and not HF_TOKEN:
        problems.append("HF_TOKEN is not set (needed for pyannote speaker diarization)")
    info["ok"] = not problems
    info["problems"] = problems
    return JSONResponse(info, status_code=200 if not problems else 503)


@app.post("/jobs", status_code=202)
def create_job(
    file: UploadFile = File(...),
    prompt: Optional[str] = Form(None),
    min_speakers: Optional[int] = Form(None),
    max_speakers: Optional[int] = Form(None),
):
    job_id = uuid.uuid4().hex
    workdir = tempfile.mkdtemp(prefix=f"job-{job_id}-")
    path = os.path.join(workdir, os.path.basename(file.filename or "audio"))
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    with jobs_lock:
        jobs[job_id] = {
            "status": "queued",
            "stage": "queued",
            "error": None,
            "result": None,
            "path": path,
            "prompt": (prompt or "").strip() or None,
            "min_speakers": min_speakers,
            "max_speakers": max_speakers,
            "created": time.time(),
        }
    work.put(job_id)
    log.info("job %s: queued (%d bytes)", job_id, os.path.getsize(path))
    return {"id": job_id}


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "no such job (the service may have restarted)")
    return {k: job[k] for k in ("status", "stage", "error", "result")}


@app.delete("/jobs/{job_id}", status_code=204)
def delete_job(job_id: str):
    with jobs_lock:
        jobs.pop(job_id, None)
