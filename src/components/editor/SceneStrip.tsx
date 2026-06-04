import { useEffect, useRef } from "react";
import { Undo2, Redo2, Plus, Upload } from "lucide-react";
import { useEditor } from "@/store/editor-store";
import { SHOT_COLORS, type Scene } from "@/lib/types";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function SortableScene({
  scene,
  index,
  active,
  onDropImage,
}: {
  scene: Scene;
  index: number;
  active: boolean;
  onDropImage: (sceneId: string, url: string) => void;
}) {
  const setActiveScene = useEditor((s) => s.setActiveScene);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: scene.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  const color = scene.shotType ? SHOT_COLORS[scene.shotType] : "#6366f1";

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => setActiveScene(scene.id)}
      onDragOver={(e) => {
        if (hasDraggedImage(e.dataTransfer)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        const url = getDraggedImageUrl(e.dataTransfer);
        if (!url) return;
        e.preventDefault();
        e.stopPropagation();
        onDropImage(scene.id, url);
      }}
      style={style}
      className={`h-32 aspect-video rounded-md shrink-0 relative overflow-hidden transition-all ${
        active
          ? "border-2 border-accent ring-2 ring-accent/20"
          : "border border-white/5 opacity-70 hover:opacity-100"
      }`}
    >
      {scene.imageUrl && (
        <img
          src={scene.imageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
        />
      )}
      <span
        className="absolute top-1 left-1 text-[8px] font-bold uppercase tracking-wider px-1 rounded text-white"
        style={{ background: color }}
      >
        {scene.shotType ?? "scene"}
      </span>
      <span className="absolute bottom-1 left-1 font-mono text-[8px] bg-black/60 px-1 rounded text-white">
        {index + 1}
      </span>
      <span className="absolute bottom-1 right-1 font-mono text-[8px] bg-black/60 px-1 rounded text-white">
        {(scene.endSec - scene.startSec).toFixed(1)}s
      </span>
    </button>
  );
}

export function SceneStrip() {
  const project = useEditor((s) => s.project)!;
  const activeId = useEditor((s) => s.activeSceneId);
  const setActiveScene = useEditor((s) => s.setActiveScene);
  const patchScenes = useEditor((s) => s.patchScenes);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  const fileRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

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

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    patchScenes((scenes) => {
      const from = scenes.findIndex((s) => s.id === active.id);
      const to = scenes.findIndex((s) => s.id === over.id);
      if (from < 0 || to < 0) return scenes;
      const moved = arrayMove(scenes, from, to);
      // Reflow times preserving each duration
      let t = 0;
      return moved.map((s) => {
        const d = s.endSec - s.startSec;
        const out = { ...s, startSec: +t.toFixed(2), endSec: +(t + d).toFixed(2) };
        t += d;
        return out;
      });
    });
  };

  const addSceneFromUrl = (url: string) => {
    if (!url) return;
    const dur = 3;
    patchScenes((scenes) => {
      const lastEnd = scenes.length ? scenes[scenes.length - 1].endSec : 0;
      return [
        ...scenes,
        {
          id: `scene-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          imageUrl: url,
          startSec: +lastEnd.toFixed(2),
          endSec: +(lastEnd + dur).toFixed(2),
          transitionType: "luxury-fade",
          shotType: "lifestyle",
        },
      ];
    });
  };

  const replaceSceneImage = (sceneId: string, url: string) => {
    patchScenes((scenes) =>
      scenes.map((scene) => (scene.id === sceneId ? { ...scene, imageUrl: url } : scene)),
    );
    setActiveScene(sceneId);
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => addSceneFromUrl(String(reader.result));
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const addFromCandidate = () => {
    const cands = project.brand.imageCandidates ?? [];
    const used = new Set(project.scenes.map((s) => s.imageUrl));
    const next = cands.find((u) => !used.has(u));
    if (next) addSceneFromUrl(next);
  };

  return (
    <div className="h-44 shrink-0 border-t border-border bg-panel/30 flex flex-col">
      <div className="h-8 flex items-center px-4 border-b border-border gap-4">
        <span className="font-mono text-[9px] text-muted-foreground tracking-widest">
          SCENES · {project.scenes.length} · {project.durationSec}s
        </span>
        <span className="font-mono text-[9px] text-muted-foreground/60">
          drag to reorder
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={addFromCandidate}
            disabled={!project.brand.imageCandidates?.length}
            title="Add from scraped images"
            className="h-6 px-2 grid place-items-center gap-1 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-30 transition-colors flex"
          >
            <Plus className="size-3" /> Candidate
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onPickFile}
          />
          <button
            onClick={() => fileRef.current?.click()}
            title="Upload images"
            className="h-6 px-2 grid place-items-center gap-1 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors flex"
          >
            <Upload className="size-3" /> Upload
          </button>
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            className="size-6 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-30 transition-colors"
          >
            <Undo2 className="size-3.5" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="Redo (⇧⌘Z)"
            className="size-6 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-white/5 disabled:opacity-30 transition-colors"
          >
            <Redo2 className="size-3.5" />
          </button>
        </div>
      </div>
      <div
        className="flex-1 min-h-0 flex items-center gap-3 px-4 py-3 overflow-x-auto"
        onDragOver={(e) => {
          if (hasDraggedImage(e.dataTransfer)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          const url = getDraggedImageUrl(e.dataTransfer);
          if (!url) return;
          e.preventDefault();
          addSceneFromUrl(url);
        }}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={project.scenes.map((s) => s.id)}
            strategy={horizontalListSortingStrategy}
          >
            {project.scenes.map((s, i) => (
              <SortableScene
                key={s.id}
                scene={s}
                index={i}
                active={s.id === activeId}
                onDropImage={replaceSceneImage}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}

function getDraggedImageUrl(dataTransfer: DataTransfer) {
  return (
    dataTransfer.getData("application/x-adstudio-image") ||
    dataTransfer.getData("text/plain")
  ).trim();
}

function hasDraggedImage(dataTransfer: DataTransfer) {
  return (
    Array.from(dataTransfer.types).includes("application/x-adstudio-image") ||
    Array.from(dataTransfer.types).includes("text/plain")
  );
}
