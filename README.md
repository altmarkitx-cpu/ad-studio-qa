# AD STUDIO

A demo MVP that turns a business website URL into a ready-to-edit ad project.

## Architecture

- **TanStack Start** (React 19, SSR) on Node
- **Supabase** for persistence
- **Lovable AI Gateway** (Gemini) for script generation
- **TanStack Query + Zustand** for client state

### Flow
1. User pastes a URL on `/` → `createGenerationJob` server fn creates a row in `generation_jobs` and kicks off the pipeline.
2. `/generate/$jobId` polls `getJob` and shows step-by-step progress.
3. Pipeline runs server-side:
   - `fetchSite.server.ts` — fetches HTML
   - `extract.server.ts` — cheerio extracts metadata, brand, scored images, contact info
   - `generateScript.server.ts` — Gemini structured JSON script
   - `generateQr.server.ts` — `qrcode` data URL
   - `assemble.server.ts` — builds `AdProject` with equal scene durations
4. Project is inserted into `ad_projects`; user is redirected to `/editor/$projectId`.
5. Editor (`EditorShell`) uses Zustand store with debounced autosave via `updateProject`.

### Server module layout
- `src/lib/ad.functions.ts` — thin file, only `createServerFn` declarations
- `src/lib/server/*.server.ts` — server-only helpers (blocked from client bundle)
- `src/lib/types.ts` — shared TS types

### Fallbacks
- Site fetch failure → uses `CAFE_MOCK` brand
- AI failure → template script using brand name
- Fewer than 5 images → padded from mock pool

## Deployment

This app now runs as a standard Node server instead of a Cloudflare Worker.

### Local

```bash
npm install
npm run build
npm start
```

### Docker

```bash
docker build -t ad-studio .
docker run -p 3000:3000 --env-file .env ad-studio
```

### Railway

- Connect the repo
- Let Railway detect the `Dockerfile`
- Add the Supabase and AI env vars
- Set the start command to `node .output/server/index.mjs` if needed

### Render

- Create a new Web Service
- Use the `render.yaml` or Dockerfile
- Add the same environment variables

### Required environment variables

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY` or the AI key your pipeline expects

## Notes

The heavy generation pipeline now belongs on a normal Node host. That keeps the React app clean and avoids Cloudflare Worker resource limits.
