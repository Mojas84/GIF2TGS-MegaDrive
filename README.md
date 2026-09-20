# GIF → TGS Studio

Render-ready reconstruction of the retro **TGS_CONSOLE / Mega Drive** GIF-to-TGS utility.

## What is included

- Retro CRT/SEGA interface matching the public app at `gif2tgs-j7tnjbtt.manus.space`.
- Drag-and-drop GIF upload with an 8 MB input limit.
- Node.js upload endpoint at `POST /api/convert`.
- Python `pixelart2tgs` conversion inside the same container.
- 64 KB output validation for Telegram animated stickers.
- `/health` endpoint for Render health checks.
- `Dockerfile` and `render.yaml` for external deployment.

## Local run

Requirements: Node.js 22+, Python 3.11+, and pnpm.

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
corepack enable
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Deploy on Render

1. Create a GitHub repository and upload the project root. Do not upload `.env`, `node_modules`, `dist`, or `.venv`.
2. In Render choose **New → Web Service** and select the repository.
3. Select **Docker** runtime, branch `main`, and the free plan.
4. Set the health check path to `/health`. The Dockerfile already listens on Render's `PORT`.
5. Deploy. The service will receive a public `onrender.com` URL.

Alternatively, use **New → Blueprint** and select the repository; Render will read `render.yaml`.

## Important limitation

The original public URL only exposed the compiled page, not the lost Manus source. This repository is a clean reconstruction of the visible interface and its GIF-to-TGS behavior; the original Sonic artwork is bundled only because it was publicly served by the prior app.
