// Thin server-fn module — declarations + imports only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchSiteHtml } from "./server/fetchSite.server";
import { extractFromHtml } from "./server/extract.server";
import { crawlAdditionalBrandAssets } from "./server/crawlAssets.server";
import { generateAdScript } from "./server/generateScript.server";
import { generateVoiceoverAudio } from "./server/generateVoiceover.server";
import { generateQrDataUrl } from "./server/generateQr.server";
import { assembleProject } from "./server/assemble.server";
import { classifyShotsWithGemini } from "./server/vision.server";
import { createFallbackBrandForUrl, fallbackImagesForBrand } from "./server/mocks.server";
import type { AdProject, BrandImageAsset, BrandProfile, StepLog } from "./types";

const urlSchema = z.object({ url: z.string().url() });
type DbJson = string | number | boolean | null | DbJson[] | { [key: string]: DbJson | undefined };
type ProjectRow = {
  id: string;
  source_url: string;
  duration_sec: number;
  brand: BrandProfile;
  script: AdProject["script"];
  scenes: AdProject["scenes"];
  qr_code_data_url: string;
  end_card: AdProject["endCard"];
  music_genre?: string | null;
  music_audio_data_url?: string | null;
  music_audio_name?: string | null;
  music_bed_id?: string | null;
  ad_category?: AdProject["adCategory"] | null;
  ad_template?: AdProject["adTemplate"] | null;
  voice_audio_url?: string | null;
  voiceover_audio_data_url?: string | null;
  voiceover_audio_name?: string | null;
  created_at: string;
};
type JobRecord = {
  id: string;
  source_url: string;
  status: "pending" | "fetching" | "extracting" | "generating" | "done" | "failed";
  step_logs: StepLog[];
  project_id?: string | null;
  error?: string | null;
};
type PixabayMusicTrack = {
  title: string;
  artist?: string;
  genre?: string;
  duration?: string;
  tags: string[];
  pageUrl: string;
};

const memoryJobs = new Map<string, JobRecord>();
const memoryProjects = new Map<string, AdProject>();
const MAX_BASE64_IMAGE_BYTES = 100_000;

function hasSupabaseEnv() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function canUseMemoryFallback() {
  return !hasSupabaseEnv() && process.env.NODE_ENV !== "production";
}

function assertStorageConfigured() {
  if (hasSupabaseEnv() || canUseMemoryFallback()) return;
  throw new Error(
    "Supabase server env vars are required in production. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  );
}

async function appendLog(jobId: string, log: StepLog, status?: string) {
  assertStorageConfigured();
  if (canUseMemoryFallback()) {
    const job = memoryJobs.get(jobId);
    if (!job) return;
    job.step_logs = job.step_logs.concat(log);
    if (status) job.status = status as JobRecord["status"];
    memoryJobs.set(jobId, job);
    return;
  }

  const { data } = await supabaseAdmin
    .from("generation_jobs")
    .select("step_logs")
    .eq("id", jobId)
    .single();
  const logs = ((data?.step_logs as StepLog[] | null) ?? []).concat(log);
  await supabaseAdmin
    .from("generation_jobs")
    .update({ step_logs: logs as unknown as DbJson, ...(status ? { status } : {}) })
    .eq("id", jobId);
}

export const createGenerationJob = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => urlSchema.parse(input))
  .handler(async ({ data }) => {
    assertStorageConfigured();
    if (canUseMemoryFallback()) {
      const jobId = crypto.randomUUID();
      memoryJobs.set(jobId, {
        id: jobId,
        source_url: data.url,
        status: "fetching",
        step_logs: [],
      });
      try {
        const projectId = await processJob(jobId, data.url);
        return { jobId, projectId, project: memoryProjects.get(projectId) ?? null };
      } catch (e: unknown) {
        console.error("[job]", e);
        const job = memoryJobs.get(jobId);
        if (job) {
          job.status = "failed";
          job.error = getErrorMessage(e);
          memoryJobs.set(jobId, job);
        }
      }
      const projectId = memoryJobs.get(jobId)?.project_id ?? null;
      return {
        jobId,
        projectId,
        project: projectId ? (memoryProjects.get(projectId) ?? null) : null,
      };
    }

    const { data: job, error } = await supabaseAdmin
      .from("generation_jobs")
      .insert({ source_url: data.url, status: "fetching", step_logs: [] })
      .select()
      .single();
    if (error || !job) throw new Error(error?.message ?? "Failed to create job");

    // Run inline — Cloudflare Workers terminate background promises after response.
    try {
      const projectId = await processJob(job.id, data.url);
      return { jobId: job.id, projectId };
    } catch (e: unknown) {
      console.error("[job]", e);
      await supabaseAdmin
        .from("generation_jobs")
        .update({ status: "failed", error: getErrorMessage(e) })
        .eq("id", job.id);
    }

    return { jobId: job.id, projectId: null };
  });

async function processJob(jobId: string, url: string): Promise<string> {
  const now = () => new Date().toISOString();
  let brand: BrandProfile;
  let usedFallback = false;
  let html = "";
  let finalUrl = url;

  // Step 1: fetch
  await appendLog(jobId, { step: "Fetching site", status: "running", at: now() }, "fetching");
  try {
    const fetched = await fetchSiteHtml(url);
    html = fetched.html;
    finalUrl = fetched.finalUrl;
    await appendLog(jobId, { step: "Fetching site", status: "done", at: now() });
  } catch (e) {
    console.error("[fetch recovery]", e);
    html = fallbackHtmlForUrl(url);
    finalUrl = url;
    usedFallback = true;
    await appendLog(jobId, {
      step: "Fetching site",
      status: "done",
      at: now(),
      detail: "Recovered from URL and screenshot",
    });
  }

  // Step 2: extract
  await appendLog(jobId, { step: "Extracting assets", status: "running", at: now() }, "extracting");
  try {
    brand = extractFromHtml(html, finalUrl);
    brand = await crawlAdditionalBrandAssets({ html, baseUrl: finalUrl, brand });
    if (isProtectedChallengeCapture(brand, html)) {
      throw new Error("Protected challenge page captured instead of website content");
    }
    brand = await materializeBrandImages(brand);
    await appendLog(jobId, {
      step: "Extracting assets",
      status: "done",
      at: now(),
      detail: `${brand.selectedImages.length} images, brand "${brand.brandName}"`,
    });
  } catch (e) {
    console.error("[extract recovery]", e);
    usedFallback = true;
    brand = createFallbackBrandForUrl(url);
    brand = await materializeBrandImages(brand);
    await appendLog(jobId, {
      step: "Extracting assets",
      status: "done",
      at: now(),
      detail: "Recovered from URL and screenshot",
    });
  }

  // Step 3: generate script
  await appendLog(jobId, { step: "Generating copy", status: "running", at: now() }, "generating");
  const script = await generateAdScript(brand);
  await appendLog(jobId, { step: "Generating copy", status: "done", at: now() });

  const shotTypes = await classifyShotsWithGemini({
    brand,
    assets: brand.imageAssets ?? [],
  });

  // Step 4: QR
  await appendLog(jobId, { step: "Building creative", status: "running", at: now() });
  let qr = "";
  try {
    qr = await generateQrDataUrl(brand.websiteUrl);
  } catch (e) {
    console.error("[qr recovery]", e);
  }

  // Step 5: assemble + insert project
  const tmpId = crypto.randomUUID();
  const project = assembleProject({
    id: tmpId,
    sourceUrl: url,
    brand,
    script,
    qrCodeDataUrl: qr,
    shotTypes,
  });

  assertStorageConfigured();
  if (canUseMemoryFallback()) {
    const projectWithId = { ...project, id: tmpId };
    memoryProjects.set(tmpId, projectWithId);
    const job = memoryJobs.get(jobId);
    if (job) {
      job.status = "done";
      job.project_id = tmpId;
      memoryJobs.set(jobId, job);
    }
    await appendLog(jobId, {
      step: "Building creative",
      status: "done",
      at: now(),
      detail: usedFallback ? "Recovered with website-safe creative" : "Local project stored",
    });
    return tmpId;
  }

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("ad_projects")
    .insert({
      source_url: project.sourceUrl,
      brand: project.brand as unknown as DbJson,
      script: project.script as unknown as DbJson,
      scenes: project.scenes as unknown as DbJson,
      qr_code_data_url: project.qrCodeDataUrl,
      end_card: project.endCard as unknown as DbJson,
      duration_sec: project.durationSec,
      music_genre: project.musicGenre,
      music_bed_id: project.musicBedId,
      ad_category: project.adCategory,
      ad_template: project.adTemplate,
    })
    .select()
    .single();
  if (insErr || !inserted) throw new Error(insErr?.message ?? "Insert failed");

  await appendLog(jobId, {
    step: "Building creative",
    status: "done",
    at: now(),
    detail: usedFallback ? "Recovered with website-safe creative" : undefined,
  });

  await supabaseAdmin
    .from("generation_jobs")
    .update({ status: "done", project_id: inserted.id })
    .eq("id", jobId);
  return inserted.id as string;
}

export const getJob = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    assertStorageConfigured();
    if (canUseMemoryFallback()) {
      const job = memoryJobs.get(data.id);
      if (!job) throw new Error("Job not found");
      return {
        id: job.id,
        status: job.status,
        sourceUrl: job.source_url,
        stepLogs: job.step_logs,
        projectId: job.project_id,
        error: job.error,
      };
    }

    const { data: job, error } = await supabaseAdmin
      .from("generation_jobs")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !job) throw new Error("Job not found");
    return {
      id: job.id,
      status: job.status,
      sourceUrl: job.source_url,
      stepLogs: (job.step_logs as StepLog[] | null) ?? [],
      projectId: job.project_id,
      error: job.error,
    };
  });

function rowToProject(row: ProjectRow): AdProject {
  const editorState = row.end_card.editorState;
  return {
    id: row.id,
    sourceUrl: row.source_url,
    durationSec: row.duration_sec,
    brand: row.brand,
    script: row.script,
    scenes: row.scenes,
    qrCodeDataUrl: row.qr_code_data_url,
    qrDestinationUrl: editorState?.qrDestinationUrl,
    qrEnabled: editorState?.qrEnabled,
    bottomBannerEnabled: editorState?.bottomBannerEnabled,
    endCard: row.end_card,
    formats: ["16:9", "9:16", "1:1"],
    musicGenre: row.music_genre,
    musicAudioDataUrl: row.music_audio_data_url ?? undefined,
    musicAudioName: row.music_audio_name ?? undefined,
    musicBedId: row.music_bed_id ?? undefined,
    musicEnabled: editorState?.musicEnabled,
    musicVolume: editorState?.musicVolume,
    adCategory: row.ad_category ?? undefined,
    adTemplate: row.ad_template ?? undefined,
    voiceAudioUrl: row.voice_audio_url,
    voiceoverAudioDataUrl: row.voiceover_audio_data_url ?? undefined,
    voiceoverAudioName: row.voiceover_audio_name ?? undefined,
    voiceoverEnabled: editorState?.voiceoverEnabled,
    voiceoverVolume: editorState?.voiceoverVolume,
    variants: editorState?.variants,
    activeVariantId: editorState?.activeVariantId,
    createdAt: row.created_at,
  };
}

export const getProject = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    assertStorageConfigured();
    if (canUseMemoryFallback()) {
      const project = memoryProjects.get(data.id);
      if (!project) throw new Error("Project not found");
      return project;
    }

    const { data: row, error } = await supabaseAdmin
      .from("ad_projects")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !row) throw new Error("Project not found");
    return rowToProject(row);
  });

export const searchPixabayMusic = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ query: z.string().trim().min(1).max(80) }).parse(input),
  )
  .handler(async ({ data }) => {
    const query = data.query;
    const urls = [
      `https://pixabay.com/music/search/${encodeURIComponent(query)}/`,
      `https://r.jina.ai/http://pixabay.com/music/search/${encodeURIComponent(query)}/`,
    ];
    for (const url of urls) {
      const tracks = await fetchPixabayMusicTracks(url);
      if (tracks.length > 0) return { query, tracks };
    }
    return { query, tracks: [] as PixabayMusicTrack[] };
  });

const patchSchema = z.object({
  id: z.string().uuid(),
  patch: z
    .object({
      brand: z.unknown().optional(),
      script: z.unknown().optional(),
      scenes: z.unknown().optional(),
      end_card: z.unknown().optional(),
      duration_sec: z.number().optional(),
      music_genre: z.string().nullable().optional(),
      music_audio_data_url: z.string().nullable().optional(),
      music_audio_name: z.string().nullable().optional(),
      music_bed_id: z.string().nullable().optional(),
      ad_category: z.string().nullable().optional(),
      ad_template: z.string().nullable().optional(),
      voiceover_audio_data_url: z.string().nullable().optional(),
      voiceover_audio_name: z.string().nullable().optional(),
      qr_code_data_url: z.string().optional(),
    })
    .passthrough(),
});

export const updateProject = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => patchSchema.parse(input))
  .handler(async ({ data }) => {
    assertStorageConfigured();
    if (canUseMemoryFallback()) {
      const project = memoryProjects.get(data.id);
      if (!project) return { ok: true };
      memoryProjects.set(data.id, applyProjectPatch(project, data.patch));
      return { ok: true };
    }

    const { error } = await supabaseAdmin
      .from("ad_projects")
      .update({ ...data.patch, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listProjects = createServerFn({ method: "GET" }).handler(async () => {
  assertStorageConfigured();
  if (canUseMemoryFallback()) {
    return Array.from(memoryProjects.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        sourceUrl: p.sourceUrl,
        brandName: p.brand.brandName,
        createdAt: p.createdAt,
      }));
  }

  const { data, error } = await supabaseAdmin
    .from("ad_projects")
    .select("id, source_url, brand, created_at")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    sourceUrl: r.source_url as string,
    brandName: (r.brand?.brandName as string) ?? "Untitled",
    createdAt: r.created_at as string,
  }));
});

export const regenerateScript = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    assertStorageConfigured();
    if (canUseMemoryFallback()) {
      const project = memoryProjects.get(data.id);
      if (!project) throw new Error("Project not found");
      const script = await generateAdScript(project.brand);
      memoryProjects.set(data.id, { ...project, script });
      return script;
    }

    const { data: row, error } = await supabaseAdmin
      .from("ad_projects")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error || !row) throw new Error("Project not found");
    const script = await generateAdScript(row.brand as unknown as BrandProfile);
    await supabaseAdmin
      .from("ad_projects")
      .update({ script: script as unknown as DbJson, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    return script;
  });

export const generateVoiceover = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        script: z.string().min(1).max(2400),
        profile: z.string().min(1).max(80),
      })
      .parse(input),
  )
  .handler(async ({ data }) => generateVoiceoverAudio(data));

function getErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeErrorMessage(message);
}

function sanitizeErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "Generation failed";
  if (/<(?:!doctype|html|head|body|script|style)\b/i.test(trimmed)) {
    return "Generation failed while loading the website.";
  }
  return trimmed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function fallbackHtmlForUrl(url: string): string {
  const brandName = brandNameFromUrl(url);
  const screenshot = `https://image.thum.io/get/width/1400/crop/800/noanimate/${encodeURIComponent(url)}`;
  const description = `${brandName} offers local service, trusted choices, and an easier way to get what you need.`;
  return `<!doctype html><html><head><title>${escapeHtml(brandName)}</title><meta property="og:title" content="${escapeHtml(brandName)}" /><meta name="description" content="${escapeHtml(description)}" /><meta property="og:description" content="${escapeHtml(description)}" /><meta property="og:image" content="${escapeHtml(screenshot)}" /></head><body><main><h1>${escapeHtml(brandName)}</h1><p>${escapeHtml(description)}</p><img src="${escapeHtml(screenshot)}" alt="${escapeHtml(brandName)}" /></main></body></html>`;
}

function brandNameFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const first = host.split(".")[0] || "Brand";
    if (first.length <= 4) return first.toUpperCase();
    return first
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "Local Business";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isProtectedChallengeCapture(brand: BrandProfile, html: string): boolean {
  const text = `${brand.brandName} ${brand.metaTitle ?? ""} ${brand.metaDescription ?? ""} ${html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .slice(0, 5000)}`.toLowerCase();
  const titleLooksBlocked = /^(just a moment|access denied|attention required|please wait|checking your browser)\.?\s*$/i.test(
    brand.brandName.trim(),
  );
  return (
    titleLooksBlocked ||
    /just a moment|verifying you are human|checking your browser|browser check|cf-browser-verification|cloudflare|challenge-platform|please enable cookies|access denied|for security reasons/i.test(
      text,
    )
  );
}

async function materializeBrandImages(brand: BrandProfile): Promise<BrandProfile> {
  const screenshot = websiteScreenshotUrl(brand.websiteUrl);
  const realAssets = mergeImageAssets(
    (brand.imageAssets && brand.imageAssets.length > 0
      ? brand.imageAssets
      : synthesizeAssetsFromUrls([...brand.selectedImages, ...brand.imageCandidates])
    ).filter((asset) => !isFallbackOrScreenshotAsset(asset)),
  );
  const fallbackUrls = ensureMinimumFallbackImages(fallbackImagesForBrand(brand), 5);
  const fallbackAssets = fallbackUrls.map((url, index): BrandImageAsset => ({
    id: `asset-stock-${String(index + 1).padStart(3, "0")}`,
    url,
    alt: `${brand.brandName} category fallback ${index + 1}`,
    source: "stock-fallback",
    kind: fallbackKindForBrand(brand),
    score: 20 - index,
  }));
  const realSelectedSource = prioritizeVisualImages([
    ...brand.selectedImages.filter((url) => !isScreenshotUrl(url)),
    ...brand.imageCandidates.filter((url) => !isScreenshotUrl(url)),
    ...realAssets.map((asset) => asset.url),
  ]).slice(0, 24);
  const realCandidateSource = prioritizeVisualImages([
    ...brand.imageCandidates.filter((url) => !isScreenshotUrl(url)),
    ...brand.selectedImages.filter((url) => !isScreenshotUrl(url)),
    ...realAssets.map((asset) => asset.url),
  ]).slice(0, 80);
  const materializedRealByUrl = await materializeImagesByUrl(
    Array.from(new Set([...realSelectedSource, ...realCandidateSource])),
  );
  const realSelectedImages = realSelectedSource
    .map((url) => materializedRealByUrl.get(url))
    .filter((url): url is string => Boolean(url));
  const realImageCandidates = realCandidateSource
    .map((url) => materializedRealByUrl.get(url))
    .filter((url): url is string => Boolean(url));
  const needsFallback = realSelectedImages.length < 3;
  const fallbackSource = needsFallback ? fallbackAssets.map((asset) => asset.url) : [];
  const fallbackByUrl = needsFallback ? await materializeImagesByUrl(fallbackSource) : new Map();
  const fallbackImages = fallbackSource
    .map((url) => fallbackByUrl.get(url))
    .filter((url): url is string => Boolean(url));
  const materializedScreenshot = await imageToRenderableUrl(screenshot).catch(() =>
    proxiedImageUrl(screenshot),
  );
  const imageAssets = [...realAssets, ...(needsFallback ? fallbackAssets : [])]
    .map((asset) => {
      const materialized = materializedRealByUrl.get(asset.url) ?? fallbackByUrl.get(asset.url);
      return materialized ? { ...asset, url: materialized } : null;
    })
    .filter((asset): asset is NonNullable<BrandProfile["imageAssets"]>[number] => Boolean(asset));
  const selectedImages = [...realSelectedImages, ...fallbackImages].slice(0, 24);
  const imageCandidates = [...realImageCandidates, ...fallbackImages].slice(0, 80);
  return {
    ...brand,
    imageAssets,
    selectedImages:
      selectedImages.length > 0
        ? selectedImages.slice(0, 12)
        : materializedScreenshot
          ? [materializedScreenshot]
          : [screenshot],
    imageCandidates: prioritizeVisualImages([
      ...imageCandidates,
      ...selectedImages,
      ...(selectedImages.length > 0 ? [] : [materializedScreenshot, screenshot]),
    ]),
  };
}

function synthesizeAssetsFromUrls(urls: string[]): BrandImageAsset[] {
  return Array.from(new Set(urls.filter((url) => Boolean(url) && !isScreenshotUrl(url))))
    .map((url, index) => ({
      id: `asset-real-${String(index + 1).padStart(3, "0")}`,
      url,
      source: "extracted-url",
      kind: fallbackKindFromUrl(url),
      score: visualImageScore(url),
    }))
    .filter((asset) => (asset.score ?? 0) > 0);
}

function isFallbackOrScreenshotAsset(asset: BrandImageAsset): boolean {
  const source = asset.source?.toLowerCase() ?? "";
  return source.includes("stock-fallback") || source.includes("screenshot") || isScreenshotUrl(asset.url);
}

function isScreenshotUrl(url: string): boolean {
  return /image\.thum\.io\/get\//i.test(url);
}

function mergeImageAssets(assets: BrandImageAsset[]): BrandImageAsset[] {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const merged: BrandImageAsset[] = [];
  for (const asset of assets) {
    if (!asset.url) continue;
    const urlKey = canonicalImageKey(asset.url);
    let id = asset.id;
    if (seenIds.has(id)) id = `${id}-${merged.length + 1}`;
    if (seenUrls.has(urlKey)) continue;
    seenIds.add(id);
    seenUrls.add(urlKey);
    merged.push({ ...asset, id });
  }
  return merged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 80);
}

function canonicalImageKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function fallbackKindForBrand(brand: BrandProfile): BrandImageAsset["kind"] {
  const text = `${brand.category ?? ""} ${brand.brandName} ${brand.websiteUrl}`.toLowerCase();
  if (/(fashion|streetwear|clothing|apparel|zara|bluorng)/.test(text)) return "lifestyle";
  if (/(auto|car|cadillac|dealer|vehicle)/.test(text)) return "product";
  if (/(cafe|coffee|restaurant|food|grocery|heb|market)/.test(text)) return "lifestyle";
  if (/(ai|software|agency|automation|saas)/.test(text)) return "hero";
  return "lifestyle";
}

function ensureMinimumFallbackImages(images: string[], minimum: number): string[] {
  const unique = Array.from(new Set(images.filter(Boolean)));
  if (unique.length === 0) return [];
  const out = [...unique];
  let cursor = 0;
  while (out.length < minimum) {
    out.push(withFallbackVariant(unique[cursor % unique.length], out.length + 1));
    cursor += 1;
  }
  return out;
}

function withFallbackVariant(url: string, variant: number): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("adstudio_fallback", String(variant));
    return parsed.toString();
  } catch {
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}adstudio_fallback=${variant}`;
  }
}

function fallbackKindFromUrl(url: string): BrandImageAsset["kind"] {
  const lower = url.toLowerCase();
  if (/(hero|banner|cover|main)/.test(lower)) return "hero";
  if (/(product|products|shop|sku|item|shirt|dress|hoodie|vehicle|food|menu)/.test(lower)) {
    return "product";
  }
  if (/(detail|close|macro|texture|fabric|ingredient|feature)/.test(lower)) return "detail";
  if (/(ugc|review|customer|testimonial|wearing)/.test(lower)) return "ugc";
  if (/(lifestyle|lookbook|editorial|street|gallery|interior)/.test(lower)) return "lifestyle";
  if (/(logo|wordmark|brandmark)/.test(lower)) return "logo";
  return "brand";
}

function prioritizeVisualImages(images: string[]): string[] {
  return Array.from(new Set(images.filter(Boolean))).sort(
    (a, b) => visualImageScore(b) - visualImageScore(a),
  );
}

function visualImageScore(url: string): number {
  const lower = url.toLowerCase();
  let score = 0;
  if (/image\.thum\.io\/get\//.test(lower)) score -= 80;
  if (/(logo|wordmark|brandmark|favicon|icon)(?:[_\-.?=/]|$)/.test(lower)) score -= 90;
  if (/(hero|banner|cover|lifestyle|lookbook|gallery|street|interior)/.test(lower)) score += 50;
  if (/(product|products|shop|sku|item|shirt|dress|hoodie|vehicle|food|menu)/.test(lower)) {
    score += 45;
  }
  if (/(detail|close|macro|texture|fabric|ingredient|feature)/.test(lower)) score += 30;
  const width = getImageWidthHint(url);
  if (width >= 900) score += 20;
  else if (width >= 500) score += 10;
  return score;
}

function getImageWidthHint(url: string): number {
  try {
    const parsed = new URL(url);
    return Number(parsed.searchParams.get("width") || parsed.searchParams.get("w") || 0);
  } catch {
    const match = url.match(/[?&](?:width|w)=(\d+)/i);
    return match ? Number(match[1]) : 0;
  }
}

function websiteScreenshotUrl(url: string): string {
  return `https://image.thum.io/get/width/1400/crop/800/noanimate/${encodeURIComponent(url)}`;
}

async function materializeImagesByUrl(images: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let cursor = 0;
  const uniqueImages = Array.from(new Set(images.filter(Boolean)));
  const workers = Array.from({ length: Math.min(8, uniqueImages.length) }, async () => {
    while (cursor < uniqueImages.length) {
      const index = cursor;
      cursor += 1;
      const image = uniqueImages[index];
      if (!image) continue;
      const materialized = await imageToRenderableUrl(image).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/too small|too large|not an image/i.test(message)) return "";
        if (/Image responded (?!403\b)\d+/i.test(message)) return "";
        return proxiedImageUrl(image);
      });
      if (materialized) out.set(image, materialized);
    }
  });
  await Promise.all(workers);
  return out;
}

async function imageToRenderableUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const validation = await validateImageUrl(url);
  if (validation.contentLength <= MAX_BASE64_IMAGE_BYTES) {
    return imageToDataUrl(url).catch(() => proxiedImageUrl(url));
  }
  return proxiedImageUrl(url);
}

async function validateImageUrl(url: string): Promise<{ contentType: string; contentLength: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: imageRequestHeaders(url),
    }).catch(() => null);
    if (!res || !res.ok || !looksLikeImageResponse(res)) {
      res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: imageRequestHeaders(url),
      });
    }
    if (!res.ok) throw new Error(`Image responded ${res.status}`);
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) throw new Error("Not an image");
    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength > 10_000_000) throw new Error("Image too large");
    if (contentLength > 0 && contentLength < 5_000) throw new Error("Image too small");
    return { contentType, contentLength };
  } finally {
    clearTimeout(timeout);
  }
}

function looksLikeImageResponse(res: Response): boolean {
  const contentType = res.headers.get("content-type") || "";
  return contentType.startsWith("image/");
}

async function imageToDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5500);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: imageRequestHeaders(url),
    });
    if (!res.ok) throw new Error(`Image responded ${res.status}`);
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) throw new Error("Not an image");
    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength > 10_000_000) throw new Error("Image too large");
    if (contentLength > 0 && contentLength < 5_000) throw new Error("Image too small");
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > 10_000_000) throw new Error("Image too large");
    if (arrayBuffer.byteLength > MAX_BASE64_IMAGE_BYTES) throw new Error("Image too large for base64");
    if (arrayBuffer.byteLength < 5_000) throw new Error("Image too small");
    return `data:${contentType};base64,${arrayBufferToBase64(arrayBuffer)}`;
  } finally {
    clearTimeout(timeout);
  }
}

function imageRequestHeaders(url: string): HeadersInit {
  return {
    Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: imageReferer(url),
    "Sec-Fetch-Dest": "image",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "cross-site",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  };
}

function proxiedImageUrl(url: string): string {
  if (/^(data:|blob:|\/api\/image\b)/i.test(url)) return url;
  return `/api/image?url=${encodeURIComponent(url)}`;
}

function imageReferer(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "https://www.google.com/";
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fetchPixabayMusicTracks(sourceUrl: string): Promise<PixabayMusicTrack[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(sourceUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/plain,text/markdown,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok) return [];
    const text = await response.text();
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const tracks: PixabayMusicTrack[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const match = line.match(
        /^\[([^\]]+)\]\((https?:\/\/pixabay\.com\/music\/[^)]+)\)\[([^\]]+)\]\((https?:\/\/pixabay\.com\/users\/[^)]+)\)$/,
      );
      if (!match) continue;
      const duration = lines[i + 1]?.match(/^\d+:\d{2}$/)?.[0];
      const genre = lines[i + 2] && !lines[i + 2].startsWith("[") ? lines[i + 2] : undefined;
      const tags = lines[i + 3] && !lines[i + 3].startsWith("[") ? lines[i + 3].split(/\s+/).slice(0, 5) : [];
      tracks.push({
        title: match[1].trim(),
        artist: match[3].trim(),
        duration,
        genre,
        tags,
        pageUrl: match[2],
      });
      if (tracks.length >= 12) break;
    }
    return tracks;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function applyProjectPatch(project: AdProject, patch: Record<string, unknown>): AdProject {
  const patchEndCard = (patch.end_card as AdProject["endCard"] | undefined) ?? project.endCard;
  return {
    ...project,
    brand: (patch.brand as AdProject["brand"] | undefined) ?? project.brand,
    script: (patch.script as AdProject["script"] | undefined) ?? project.script,
    scenes: (patch.scenes as AdProject["scenes"] | undefined) ?? project.scenes,
    endCard: patchEndCard,
    durationSec: (patch.duration_sec as number | undefined) ?? project.durationSec,
    musicGenre: (patch.music_genre as string | null | undefined) ?? project.musicGenre,
    musicAudioDataUrl:
      (patch.music_audio_data_url as string | undefined) ?? project.musicAudioDataUrl,
    musicAudioName: (patch.music_audio_name as string | undefined) ?? project.musicAudioName,
    musicBedId: (patch.music_bed_id as string | undefined) ?? project.musicBedId,
    adCategory: (patch.ad_category as AdProject["adCategory"] | undefined) ?? project.adCategory,
    adTemplate: (patch.ad_template as AdProject["adTemplate"] | undefined) ?? project.adTemplate,
    voiceoverAudioDataUrl:
      (patch.voiceover_audio_data_url as string | undefined) ?? project.voiceoverAudioDataUrl,
    voiceoverAudioName:
      (patch.voiceover_audio_name as string | undefined) ?? project.voiceoverAudioName,
    qrCodeDataUrl: (patch.qr_code_data_url as string | undefined) ?? project.qrCodeDataUrl,
    qrDestinationUrl:
      (patch.qr_destination_url as string | undefined) ??
      patchEndCard.editorState?.qrDestinationUrl ??
      project.qrDestinationUrl,
    qrEnabled:
      (patch.qr_enabled as boolean | undefined) ??
      patchEndCard.editorState?.qrEnabled ??
      project.qrEnabled,
    bottomBannerEnabled:
      (patch.bottom_banner_enabled as boolean | undefined) ??
      patchEndCard.editorState?.bottomBannerEnabled ??
      project.bottomBannerEnabled,
    musicEnabled:
      (patch.music_enabled as boolean | undefined) ??
      patchEndCard.editorState?.musicEnabled ??
      project.musicEnabled,
    musicVolume:
      (patch.music_volume as number | undefined) ??
      patchEndCard.editorState?.musicVolume ??
      project.musicVolume,
    voiceoverEnabled:
      (patch.voiceover_enabled as boolean | undefined) ??
      patchEndCard.editorState?.voiceoverEnabled ??
      project.voiceoverEnabled,
    voiceoverVolume:
      (patch.voiceover_volume as number | undefined) ??
      patchEndCard.editorState?.voiceoverVolume ??
      project.voiceoverVolume,
    variants:
      (patch.variants as AdProject["variants"] | undefined) ??
      patchEndCard.editorState?.variants ??
      project.variants,
    activeVariantId:
      (patch.active_variant_id as string | undefined) ??
      patchEndCard.editorState?.activeVariantId ??
      project.activeVariantId,
  };
}
