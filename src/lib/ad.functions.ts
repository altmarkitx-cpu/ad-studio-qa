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
import { createFallbackBrandForUrl } from "./server/mocks.server";
import type { AdProject, BrandProfile, StepLog } from "./types";

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

const memoryJobs = new Map<string, JobRecord>();
const memoryProjects = new Map<string, AdProject>();

function hasSupabaseEnv() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function appendLog(jobId: string, log: StepLog, status?: string) {
  if (!hasSupabaseEnv()) {
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
    if (!hasSupabaseEnv()) {
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
  });

  if (!hasSupabaseEnv()) {
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
    if (!hasSupabaseEnv()) {
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
    if (!hasSupabaseEnv()) {
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
    if (!hasSupabaseEnv()) {
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
  if (!hasSupabaseEnv()) {
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
    if (!hasSupabaseEnv()) {
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
  return error instanceof Error ? error.message : String(error);
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

async function materializeBrandImages(brand: BrandProfile): Promise<BrandProfile> {
  const screenshot = websiteScreenshotUrl(brand.websiteUrl);
  const selectedSource = prioritizeVisualImages([
    ...brand.selectedImages,
    ...brand.imageCandidates,
    screenshot,
  ]).slice(0, 24);
  const candidateSource = prioritizeVisualImages([
    ...brand.imageCandidates,
    ...brand.selectedImages,
    screenshot,
  ]).slice(0, 80);
  const [selectedImages, imageCandidates] = await Promise.all([
    materializeImages(selectedSource),
    materializeImages(candidateSource),
  ]);
  return {
    ...brand,
    selectedImages: selectedImages.length > 0 ? selectedImages : [screenshot],
    imageCandidates: prioritizeVisualImages([...imageCandidates, ...selectedImages, screenshot]),
  };
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

async function materializeImages(images: string[]): Promise<string[]> {
  const out = new Array<string>(images.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(6, images.length) }, async () => {
    while (cursor < images.length) {
      const index = cursor;
      cursor += 1;
      const image = images[index];
      out[index] = await imageToDataUrl(image).catch(() => image);
    }
  });
  await Promise.all(workers);
  return out.filter(Boolean);
}

async function imageToDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" },
    });
    if (!res.ok) throw new Error(`Image responded ${res.status}`);
    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) throw new Error("Not an image");
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > 8_000_000) throw new Error("Image too large");
    return `data:${contentType};base64,${arrayBufferToBase64(arrayBuffer)}`;
  } finally {
    clearTimeout(timeout);
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
