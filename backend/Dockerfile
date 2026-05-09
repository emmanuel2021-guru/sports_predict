FROM python:3.11-slim

WORKDIR /app

# System deps for curl_cffi
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Persistent volume mount point for the SQLite DB. The app writes to
# `<repo_root>/match_picks.db` (parent of /app/backend) — mount your
# host's persistent volume there.
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Workers: 1 for the SSE streaming model — multiple workers + in-memory BRIEFS_CACHE
# would mean cache misses across worker boundaries. Keep at 1 unless you migrate
# the cache to Redis.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
