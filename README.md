# 🎯 Markets Pro — Unified App

Multi-sport AI betting analyst (Football · Basketball · Tennis) with FastAPI backend + Next.js 14 frontend.

```
unified_app/
├── backend/                  # FastAPI service
│   ├── main.py
│   ├── sport_logic.py
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .dockerignore
├── frontend/                 # Next.js + TailwindCSS
│   ├── app/
│   │   ├── page.tsx          # Redirects to /football
│   │   ├── [sport]/page.tsx  # Per-sport slate (/football, /basketball, /tennis)
│   │   ├── match/[id]/page.tsx
│   │   └── picks/page.tsx
│   ├── components/
│   ├── lib/
│   ├── package.json
│   └── tailwind.config.ts
├── render.yaml               # One-click deploy to Render (backend)
└── README.md
```

## Local development

### Backend (`:8000`)

```bash
cd backend
pip install -r requirements.txt

$env:ANTHROPIC_API_KEY = "sk-ant-..."   # PowerShell
# or: export ANTHROPIC_API_KEY="sk-ant-..."   # bash

uvicorn main:app --reload --port 8000
```

### Frontend (`:3000`)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000` — you'll be redirected to `/football`.

## Backend env vars

| Var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required) | Anthropic key |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | Model to use |
| `CLAUDE_THINKING` | `enabled` | `enabled` / `adaptive` / `disabled` |
| `CLAUDE_EFFORT` | `medium` | `low` / `medium` / `high` (Sonnet/Opus only) |
| `CLAUDE_MAX_TOKENS` | `2048` | Hard cap on output |
| `CLAUDE_COMPACT_BRIEF` | `true` | Trim H2H/form to save input tokens |
| `CORS_ORIGINS` | local dev only | Comma-separated frontend origins |
| `PICKS_DB_PATH` | `<repo>/match_picks.db` | SQLite path (use a persistent disk in prod) |

Verify config: `curl http://localhost:8000/api/health`

## Going live — deploy guide

**Stack:** Frontend on **Vercel** (free), backend on **Render** (Starter plan, $7/mo for persistent disk). Two services, deployed independently.

### 1. Backend → Render

1. Push the repo to GitHub.
2. In the Render dashboard: **New → Blueprint** → connect the repo.
3. Render reads `unified_app/render.yaml` and provisions:
   - Docker web service from `backend/Dockerfile`
   - 1GB persistent disk mounted at `/data` for the SQLite DB
4. After provisioning, set the environment variables Render flagged (`sync: false`) in the dashboard:
   - `ANTHROPIC_API_KEY` — your key
   - `CORS_ORIGINS` — leave blank for now, set after frontend deploys
5. Wait for the build. Visit `https://<your-service>.onrender.com/api/health` — should return `{"status": "ok", ...}`.

> **Free tier alternative:** If $7/mo is too steep, use Fly.io (free volumes) or skip persistence entirely (picks won't survive deploys).

### 2. Frontend → Vercel

1. In the Vercel dashboard: **New Project** → import the repo.
2. Set **Root Directory** to `unified_app/frontend`.
3. Add environment variable:
   - `NEXT_PUBLIC_BACKEND_URL` = your Render URL (e.g. `https://markets-pro-backend.onrender.com`)
4. Deploy. Vercel auto-detects Next.js and builds.
5. Note your Vercel URL (e.g. `https://markets-pro.vercel.app`).

### 3. Connect them

Back in Render dashboard, set:
- `CORS_ORIGINS` = your Vercel URL (e.g. `https://markets-pro.vercel.app`)

Restart the backend service. Frontend should now talk to the backend.

### 4. Verify

1. Visit your Vercel URL.
2. Sidebar → click any sport → slate loads.
3. Click a match → quant card renders, Claude analysis streams.
4. Visit `/picks` → saved picks appear (will be empty on first deploy if you didn't migrate the local DB).

## Streaming gotcha

The frontend's EventSource (Claude SSE) hits the backend **directly** — not through the Next.js rewrite proxy — because Next.js dev/edge proxies buffer SSE responses. This is handled in `lib/api.ts` via `NEXT_PUBLIC_BACKEND_URL`. Make sure that env var is set in Vercel.

## Files of note

- `backend/sport_logic.py` — analyze fns + Claude prompts per sport
- `backend/main.py` — FastAPI endpoints + SSE streaming
- `frontend/components/SlateView.tsx` — reusable slate browser used by all sport routes
- `frontend/components/Sidebar.tsx` — primary nav (sport + date)
- `frontend/components/ClaudeAnalysis.tsx` — SSE consumer with thinking heartbeat
