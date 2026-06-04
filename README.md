# AD STUDIO

A demo MVP that turns a business website URL into a ready-to-edit ad project.

## Architecture

- **TanStack Start** (React 19, SSR) on Node
- **Supabase** for production persistence
- **Gemini** for script generation
- **TanStack Query + Zustand** for client state

### Flow

1. User pastes a URL on `/`; `createGenerationJob` creates a `generation_jobs` row and runs the pipeline.
2. `/generate/$jobId` polls `getJob` and shows progress.
3. Pipeline runs server-side:
   - `fetchSite.server.ts` fetches HTML with browser fallback for hard/lazy-loaded sites.
   - `extract.server.ts` extracts metadata, brand, typed image assets, and contact info.
   - `generateScript.server.ts` asks Gemini for structured JSON mapped to extracted visual assets.
   - `generateQr.server.ts` creates the QR code data URL.
   - `assemble.server.ts` builds the `AdProject` with equal scene durations and `visualAssetId` links.
4. Project is inserted into `ad_projects`; user is redirected to `/editor/$projectId`.
5. Editor uses Zustand with debounced autosave through `updateProject`.

### Server Module Layout

- `src/lib/ad.functions.ts` contains the `createServerFn` declarations.
- `src/lib/server/*.server.ts` contains server-only helpers.
- `src/lib/types.ts` contains shared TypeScript types.

### Fallbacks

- Site fetch failure recovers from URL metadata, screenshot fallback, and category stock assets.
- AI failure uses a template script with the extracted brand name.
- Too few scene images are padded from the category fallback image pool.
- Failed direct image materialization uses `/api/image?url=...` as a proxy fallback.
- Production storage requires Supabase env vars; in-memory fallback is local/dev only.

## Deployment

This app runs as a standard Node server. Railway is the preferred target.

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

- Connect the repo or use `railway up`.
- Use Dockerfile builder.
- Use `npm start` as the start command.
- Add the required Supabase and Gemini environment variables.
- After deploy, open `/api/runtime` on the Railway URL. It should show `node22: true`, `expectedBuilder: "dockerfile"`, and `expectedStartCommand: "npm start"`.

### Required Environment Variables

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`

## Notes

Existing broken projects are not repaired automatically. Regenerate the ad after deployment so scenes are rebuilt with the new asset-aware pipeline.
