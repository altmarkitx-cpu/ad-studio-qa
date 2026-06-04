import type { Scene, ShotType, TransitionPreset } from "@/lib/types";

export function createImageScene(imageUrl: string, index: number): Scene {
  const shotType = inferShotType(imageUrl, index);
  return {
    id: `scene-${crypto.randomUUID()}`,
    role: "product",
    shotType,
    transitionPreset: "luxury-fade",
    imageUrl,
    startSec: 0,
    endSec: 5,
    headline:
      shotType === "detail"
        ? "Built With Detail."
        : shotType === "ugc"
          ? "Loved By Customers."
          : "Made To Stand Out.",
    subtitle: "A sharper look at what makes this brand different.",
    transitionType: "fade",
  };
}

export function appendImageScenes(scenes: Scene[], imageUrls: string[]): Scene[] {
  return insertImageScenes(scenes, imageUrls, scenes.length);
}

export function insertImageScenes(scenes: Scene[], imageUrls: string[], insertAt: number): Scene[] {
  return insertImageScenesWithIds(scenes, imageUrls, insertAt).scenes;
}

export function insertImageScenesWithIds(
  scenes: Scene[],
  imageUrls: string[],
  insertAt: number,
): { scenes: Scene[]; insertedIds: string[] } {
  const validImages = imageUrls.filter(Boolean);
  if (validImages.length === 0) return { scenes, insertedIds: [] };
  const clampedIndex = Math.max(0, Math.min(insertAt, scenes.length));
  const additions = validImages.map((imageUrl, offset) =>
    createImageScene(imageUrl, clampedIndex + offset),
  );
  return {
    scenes: normalizeSceneTimes([
      ...scenes.slice(0, clampedIndex),
      ...additions,
      ...scenes.slice(clampedIndex),
    ]),
    insertedIds: additions.map((scene) => scene.id),
  };
}

export function autoAssignShots(scenes: Scene[]): Scene[] {
  return normalizeSceneTimes(
    scenes.map((scene, index) => {
      const shotType = inferShotType(scene.imageUrl, index);
      return {
        ...scene,
        role: index === 0 ? "hook" : index === scenes.length - 1 ? "endcard" : scene.role,
        shotType,
        transitionPreset: transitionForShot(shotType),
      };
    }),
  );
}

export function normalizeSceneTimes(scenes: Scene[]): Scene[] {
  let time = 0;
  return scenes.map((scene) => {
    const duration = Math.max(1, scene.endSec - scene.startSec || 5);
    const next = {
      ...scene,
      startSec: +time.toFixed(2),
      endSec: +(time + duration).toFixed(2),
    };
    time += duration;
    return next;
  });
}

export function inferShotType(imageUrl: string, index: number): ShotType {
  const lower = imageUrl.toLowerCase();
  if (/(detail|close|fabric|texture|wash|gsm)/.test(lower)) return "detail";
  if (/(model|wear|fit|look|street|lifestyle|redo)/.test(lower)) return "lifestyle";
  if (/(ugc|review|customer|person|img_)/.test(lower)) return "ugc";
  if (/(logo|brand|cover)/.test(lower)) return "brand";
  return index % 4 === 0
    ? "lifestyle"
    : index % 4 === 1
      ? "product"
      : index % 4 === 2
        ? "detail"
        : "ugc";
}

export function transitionForShot(shotType: ShotType | undefined): TransitionPreset {
  return "luxury-fade";
}

export function brandedFallbackImage(label: string, accent = "#f97316"): string {
  const safeLabel = label.trim().slice(0, 28) || "AD STUDIO";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 800" role="img" aria-label="${escapeXml(
      safeLabel,
    )}">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#050506"/>
          <stop offset="55%" stop-color="#141416"/>
          <stop offset="100%" stop-color="#09090a"/>
        </linearGradient>
      </defs>
      <rect width="1400" height="800" fill="url(#g)"/>
      <circle cx="1120" cy="170" r="210" fill="${accent}" fill-opacity=".14"/>
      <circle cx="280" cy="620" r="240" fill="${accent}" fill-opacity=".08"/>
      <text x="90" y="640" fill="rgba(255,255,255,.15)" font-family="Inter, Arial, sans-serif" font-size="118" font-weight="800">${escapeXml(
        safeLabel,
      )}</text>
      <rect x="90" y="690" width="360" height="12" rx="6" fill="${accent}" fill-opacity=".72"/>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
