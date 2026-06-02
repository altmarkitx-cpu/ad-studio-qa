# Fix generation + extend editor

## 1. Root cause: generation never progresses

Your screenshot shows all 4 steps as pending (grey dots) forever. The reason is in `src/lib/ad.functions.ts`:

```ts
processJob(job.id, data.url).catch(...)  // fire-and-forget
return { jobId: job.id }
```

The server runs on Cloudflare Workers. As soon as the handler returns, the Worker invocation **terminates** — the background promise is killed before any step executes. That's why no log rows are ever written.

**Fix:** `await processJob(...)` inside the handler, so the work runs to completion within the request, then return `{ jobId }`. The progress UI will still animate (the steps write logs as they go, and the polling query keeps catching up) and on the final response the page navigates to the editor.

Trade-off: the client's `createGenerationJob` call now takes ~10–30s. That's fine — the page is already a progress screen with a polling spinner.

## 2. Editor improvements

The user request mentions a `LeftSidebarTabs` component but this project doesn't have one — the equivalent is the right-side **Inspector** ("Slideshow" tab) and the bottom **SceneStrip**. I'll add the requested behavior there.

### 2a. Per-scene duration slider (1–10s, redistribute siblings)
- Replace the existing 1–8 slider in `Inspector.tsx` with a 1–10s slider.
- Keep the same proportional rebuild of `startSec`/`endSec` across all scenes; update `durationSec` to the new total.
- Mirror the slider on each thumbnail in `SceneStrip` when a scene is active (expanded state).

### 2b. Upload custom image per scene
- Add an "Upload image" button in the Inspector's Scene section.
- Reads file via `<input type="file">`, converts to a data URL, sets `scene.imageUrl`.
- (Keeps everything client-side; no storage bucket needed for the demo.)

### 2c. Transition type per scene
- Extend `Scene` type with `transitionType?: 'cut' | 'fade' | 'slide' | 'zoom'` (default `'fade'`).
- Add a `<select>` in the Inspector Scene section bound to it.

### 2d. Undo/Redo for scene edits
- Add `past: Scene[][]` and `future: Scene[][]` arrays to the Zustand store, plus `undo()` / `redo()` actions.
- Wrap any `scenes` mutation through a `patchScenes(next)` helper that pushes the previous `scenes` onto `past` and clears `future`.
- Add Undo/Redo icon buttons in the `SceneStrip` header, disabled when stacks are empty. Keyboard: ⌘Z / ⇧⌘Z.

### 2e. AI rewrite script button
- The Inspector's "Voice & Script" tab already has the script field. Add a "Rewrite with AI" button next to it that calls the existing `regenerateScript` server fn, then patches the returned script into the store (no full page reload).

## 3. Files touched

- `src/lib/ad.functions.ts` — await processJob (1-line fix)
- `src/lib/types.ts` — add `transitionType` to `Scene`
- `src/store/editor-store.ts` — undo/redo stacks + `patchScenes`
- `src/components/editor/Inspector.tsx` — upload image, transition dropdown, expanded slider 1–10, AI rewrite button
- `src/components/editor/SceneStrip.tsx` — undo/redo buttons, keyboard shortcuts

## 4. Out of scope

- Real video render (still JSON export only).
- Persisting uploaded images to Supabase Storage — data URLs are saved in the project JSON for the demo.
- Drag-to-reorder scenes (undo/redo is wired so it's trivial to add later).

Approve and I'll implement.
