# The transcribe-hearings job (server/src/transcribeHearings.ts), packaged
# for the GPU box. Build context is server/ (see docker-compose.yml). Kept
# out of server/ itself on purpose: Railway builds that directory and would
# switch every service there to this Dockerfile if it found one.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
# Full install: the npm scripts run through tsx (a devDependency).
# ffmpeg-static's install script downloads its static ffmpeg binary here.
RUN npm ci
COPY . .
ENV NODE_ENV=production
# Runs, then waits INTERVAL_SECONDS after each run finishes — so runs never
# overlap however long a backlog takes (the job also holds a Postgres
# advisory lock against the Railway fallback).
CMD ["sh", "-c", "while true; do npm run transcribe-hearings -- --limit=${DIARIZE_LIMIT:-2}; sleep ${INTERVAL_SECONDS:-1800}; done"]
