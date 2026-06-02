import { useEffect, useState, type DragEvent } from "react";
import { Undo2, Redo2 } from "lucide-react";
import { useEditor } from "@/store/editor-store";
import { insertImageScenesWithIds } from "@/lib/scene-utils";
import type { AdProject } from "@/lib/types";

export function SceneStrip() {
  const project = useEditor((s) => s.project)!;
  const activeId = useEditor((s) => s.activeSceneId);
  const setActiveScene = useEditor((s) => s.setActiveScene);
  const patch = useEditor((s) => s.patch);
  const patchScenes = useEditor((s) => s.patchScenes);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable)
        return;
      if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return (
    <div className="h-44 border-t border-border bg-panel/30 flex flex-col shrink-0">
      <div className="h-8 flex items-center px-4 border-b border-border gap-4">
        <span className="font-mono text-[9px] text-muted-foreground tracking-widest">
          TIMELINE · {project.scenes.length} SCENES · {project.durationSec}s
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            className="size-6 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <Undo2 className="size-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="Redo (⇧⌘Z)"
            className="size-6 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          >
            <Redo2 className="size-3.5" />
          </button>
        </div>
      </div>
      <div
        className={`flex-1 flex gap-2 overflow-x-auto p-3 transition-colors ${
          dropIndex !== null ? "bg-accent/5" : ""
        }`}
        onDragOver={(event) => {
          if (!hasTimelineDrop(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = hasSceneDrop(event.dataTransfer) ? "move" : "copy";
          setDropIndex(project.scenes.length);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDropIndex(null);
        }}
        onDrop={(event) => void handleDrop(event, project.scenes.length)}
      >
        {project.scenes.map((s, i) => {
          const active = s.id === activeId;
          return (
            <button
              key={s.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-creative-spark-scene", s.id);
              }}
              onClick={() => setActiveScene(s.id)}
              onDragOver={(event) => {
                if (!hasTimelineDrop(event.dataTransfer)) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = hasSceneDrop(event.dataTransfer) ? "move" : "copy";
                setDropIndex(getInsertIndex(event, i));
              }}
              onDrop={(event) => void handleDrop(event, getInsertIndex(event, i))}
              className={`h-full aspect-video rounded-md shrink-0 relative overflow-hidden transition-all ${
                active
                  ? "border-2 border-accent ring-2 ring-accent/20"
                  : "border border-white/5 opacity-60 hover:opacity-100"
              }`}
              style={{ background: "#0a0a0b" }}
            >
              {dropIndex === i && <DropMarker side="left" />}
              {dropIndex === i + 1 && <DropMarker side="right" />}
              {s.imageUrl && (
                <img
                  src={s.imageUrl}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => {
                    const img = e.currentTarget as HTMLImageElement;
                    const fallback =
                      project.brand.selectedImages.find((url) => url !== s.imageUrl) ??
                      project.brand.imageCandidates.find((url) => url !== s.imageUrl) ??
                      project.scenes.find((scene) => scene.id !== s.id && scene.imageUrl) ??
                      `https://image.thum.io/get/width/900/crop/700/noanimate/${encodeURIComponent(project.brand.websiteUrl || project.sourceUrl)}`;
                    if (img.dataset.fallbackTried !== "true" && fallback) {
                      img.dataset.fallbackTried = "true";
                      img.src = fallback;
                      return;
                    }
                    img.style.display = "none";
                  }}
                />
              )}
              <span className="absolute bottom-1 left-1 font-mono text-[8px] bg-black/60 px-1 rounded text-white">
                {i + 1}
              </span>
              <span className="absolute bottom-1 right-1 font-mono text-[8px] bg-black/60 px-1 rounded text-white">
                {(s.endSec - s.startSec).toFixed(1)}s
              </span>
            </button>
          );
        })}
        {project.scenes.length === 0 && (
          <div className="grid h-full min-w-64 place-items-center rounded-md border border-dashed border-white/10 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Drop images here
          </div>
        )}
      </div>
    </div>
  );

  async function handleDrop(event: DragEvent<HTMLElement>, index: number) {
    if (!hasTimelineDrop(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const movedSceneId = event.dataTransfer.getData("application/x-creative-spark-scene");
    if (movedSceneId) {
      setDropIndex(null);
      patchScenes((scenes) => reorderScenes(scenes, movedSceneId, index));
      return;
    }
    const images = await materializeImagesForVideo(await getDroppedImages(event.dataTransfer));
    window.__creativeSparkDragImages = undefined;
    setDropIndex(null);
    if (images.length === 0) return;
    let firstInsertedId: string | undefined;
    patch((project) => {
      const inserted = insertImageScenesWithIds(project.scenes, images, index);
      firstInsertedId = inserted.insertedIds[0];
      return {
        ...project,
        scenes: inserted.scenes,
        durationSec: Math.round(
          inserted.scenes.reduce(
            (total, scene) => total + Math.max(0, scene.endSec - scene.startSec),
            0,
          ),
        ),
        brand: addImagesToBrandLibrary(project.brand, images),
      };
    });
    if (firstInsertedId) setActiveScene(firstInsertedId);
  }
}

function DropMarker({ side }: { side: "left" | "right" }) {
  return (
    <span
      className={`pointer-events-none absolute bottom-1 top-1 z-20 w-1 rounded-full bg-accent shadow-[0_0_18px_rgba(255,255,255,.45)] ${
        side === "left" ? "-left-1" : "-right-1"
      }`}
    />
  );
}

function getInsertIndex(event: DragEvent<HTMLElement>, sceneIndex: number) {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX < rect.left + rect.width / 2 ? sceneIndex : sceneIndex + 1;
}

function hasImageDrop(dataTransfer: DataTransfer) {
  return (
    Boolean(window.__creativeSparkDragImages?.length) ||
    dataTransfer.types.includes("application/x-creative-spark-image") ||
    dataTransfer.types.includes("text/uri-list") ||
    dataTransfer.types.includes("text/plain") ||
    Array.from(dataTransfer.items).some(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    )
  );
}

function hasSceneDrop(dataTransfer: DataTransfer) {
  return dataTransfer.types.includes("application/x-creative-spark-scene");
}

function hasTimelineDrop(dataTransfer: DataTransfer) {
  return hasImageDrop(dataTransfer) || hasSceneDrop(dataTransfer);
}

function reorderScenes<T extends { id: string; startSec: number; endSec: number }>(
  scenes: T[],
  sceneId: string,
  insertAt: number,
): T[] {
  const currentIndex = scenes.findIndex((scene) => scene.id === sceneId);
  if (currentIndex < 0) return scenes;
  const moving = scenes[currentIndex];
  const without = scenes.filter((scene) => scene.id !== sceneId);
  const adjustedIndex = currentIndex < insertAt ? insertAt - 1 : insertAt;
  const next = [...without.slice(0, adjustedIndex), moving, ...without.slice(adjustedIndex)];
  let time = 0;
  return next.map((scene) => {
    const duration = Math.max(1, scene.endSec - scene.startSec);
    const out = { ...scene, startSec: time, endSec: time + duration };
    time += duration;
    return out;
  });
}

async function getDroppedImages(dataTransfer: DataTransfer): Promise<string[]> {
  if (window.__creativeSparkDragImages?.length) return window.__creativeSparkDragImages;

  const custom = dataTransfer.getData("application/x-creative-spark-image");
  if (custom) {
    try {
      const parsed = JSON.parse(custom) as { imageUrls?: unknown };
      if (Array.isArray(parsed.imageUrls)) {
        return parsed.imageUrls.filter((url): url is string => typeof url === "string" && url);
      }
    } catch {
      // Fall back to regular text payloads below.
    }
  }

  const files = Array.from(dataTransfer.files).filter((file) => file.type.startsWith("image/"));
  if (files.length > 0) return Promise.all(files.map(readFileAsDataUrl));

  const uriList = dataTransfer
    .getData("text/uri-list")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (uriList.length > 0) return uriList;

  const plain = dataTransfer.getData("text/plain").trim();
  return plain ? [plain] : [];
}

declare global {
  interface Window {
    __creativeSparkDragImages?: string[];
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

async function materializeImagesForVideo(imageUrls: string[]): Promise<string[]> {
  const out = await Promise.all(imageUrls.map(materializeImageForVideo));
  return out.filter(Boolean);
}

async function materializeImageForVideo(src: string): Promise<string> {
  if (!src || /^(data:|blob:)/i.test(src)) return src;
  try {
    const response = await fetch(toRenderableImageUrl(src));
    if (!response.ok) throw new Error(`Image responded ${response.status}`);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("URL was not an image");
    if (blob.size > 8_000_000) return src;
    return await blobToDataUrl(blob);
  } catch {
    return src;
  }
}

function toRenderableImageUrl(src: string): string {
  if (!src || /^(data:|blob:|\/api\/image\b)/i.test(src)) return src;
  if (!/^https?:\/\//i.test(src)) return src;
  return src;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function addImagesToBrandLibrary(
  brand: AdProject["brand"],
  imageUrls: string[],
): AdProject["brand"] {
  const nextCandidates = Array.from(new Set([...imageUrls, ...brand.imageCandidates]));
  const nextSelected = Array.from(new Set([...imageUrls, ...brand.selectedImages])).slice(0, 24);
  return {
    ...brand,
    imageCandidates: nextCandidates,
    selectedImages: nextSelected,
  };
}
