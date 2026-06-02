import type { Scene, ShotType, TransitionPreset } from "@/lib/types";

export function createImageScene(imageUrl: string, index: number): Scene {
  const shotType = inferShotType(imageUrl, index);
  return {
    id: `scene-${crypto.randomUUID()}`,
    role: "product",
    shotType,
    transitionPreset: transitionForShot(shotType),
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
  if (shotType === "detail") return "hard-flash";
  if (shotType === "ugc") return "glitch-drop";
  if (shotType === "brand") return "luxury-fade";
  return "street-cut";
}
