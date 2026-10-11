# GPU transcription service (WhisperX). See app.py and server/README.md
# ("Hearing transcripts" → "Running transcription on your own GPU").
#
# CUDA 12.8 + cuDNN 9 base: WhisperX 3.8 pins torch 2.8 (CUDA 12.8 wheels),
# and faster-whisper's CTranslate2 backend needs cuDNN 9 on the system
# library path, which the pip-installed nvidia-* wheels don't provide.
# Host requirement: NVIDIA driver >= 570.
FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models/huggingface \
    TORCH_HOME=/models/torch \
    NLTK_DATA=/opt/nltk_data \
    PATH=/opt/venv/bin:$PATH

# libpython3.12t64: torchcodec (pulled in by pyannote) dlopens the shared
# libpython, which Ubuntu's python3 package doesn't ship on its own.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv libpython3.12t64 ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
# Word alignment's sentence splitter otherwise downloads this on first use.
RUN python -c "import nltk; nltk.download('punkt_tab', download_dir='/opt/nltk_data', quiet=True)"

WORKDIR /app
COPY app.py /app/app.py

EXPOSE 8000
# Model weights (Whisper, wav2vec2, pyannote) download on first use into
# /models — mount a volume there so they survive container rebuilds.
VOLUME /models
HEALTHCHECK --interval=60s --timeout=10s --start-period=120s \
  CMD curl -fsS http://localhost:8000/health || exit 1
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
