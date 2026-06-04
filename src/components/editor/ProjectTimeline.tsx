import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/store/editor-store";
import { SHOT_COLORS } from "@/lib/types";

export function ProjectTimeline() {
  const project = useEditor((s) => s.project)!;
  const activeId = useEditor((s) => s.activeSceneId);
  const time = useEditor((s) => s.time);
  const setTime = useEditor((s) => s.setTime);
  const seekToScene = useEditor((s) => s.seekToScene);
  const patchScenes = useEditor((s) => s.patchScenes);

  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<null | { kind: "head" } | { kind: "trim"; id: string }>(
    null,
  );

  const total = project.durationSec;

  // Global drag handlers
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const track = trackRef.current;
      if (!track) return;
      const r = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const t = ratio * total;
      if (dragging.kind === "head") {
        setTime(t);
      } else {
        const id = dragging.id;
        patchScenes((scenes) => {
          const idx = scenes.findIndex((s) => s.id === id);
          if (idx < 0) return scenes;
          const newEnd = Math.max(scenes[idx].startSec + 0.5, Math.min(t, total));
          const newDur = newEnd - scenes[idx].startSec;
          // Rebuild times from durations
          const durs = scenes.map((s, i) =>
            i === idx ? newDur : s.endSec - s.startSec,
          );
          let acc = 0;
          return scenes.map((s, i) => {
            const d = durs[i];
            const out = { ...s, startSec: +acc.toFixed(2), endSec: +(acc + d).toFixed(2) };
            acc += d;
            return out;
          });
        });
      }
    };
    const onUp = () => setDragging(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, total, setTime, patchScenes]);

  const onTrackClick = (e: React.MouseEvent) => {
    const r = trackRef.current!.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setTime(ratio * total);
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
    seekToScene(sceneId);
  };

  return (
    <div className="px-4 py-3 border-t border-border bg-black/40 shrink-0">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[9px] text-muted-foreground tracking-widest uppercase">
          Timeline
        </span>
        <span className="font-mono text-[9px] text-muted-foreground tabular-nums">
          {time.toFixed(2)}s / {total.toFixed(2)}s
        </span>
      </div>
      <div
        ref={trackRef}
        onClick={onTrackClick}
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
        className="relative h-20 rounded-md bg-white/5 overflow-hidden cursor-pointer select-none"
      >
        {/* Scene blocks */}
        {project.scenes.map((s) => {
          const left = (s.startSec / total) * 100;
          const width = ((s.endSec - s.startSec) / total) * 100;
          const isActive = s.id === activeId;
          const color = s.shotType ? SHOT_COLORS[s.shotType] : "#6366f1";
          return (
            <div
              key={s.id}
              onClick={(e) => {
                e.stopPropagation();
                seekToScene(s.id);
              }}
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
                replaceSceneImage(s.id, url);
              }}
              className={`absolute top-0 bottom-0 group transition-all ${
                isActive ? "ring-2 ring-white/80 z-10" : "ring-1 ring-white/10"
              }`}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: `linear-gradient(180deg, ${color}55, ${color}22)`,
              }}
            >
              {s.imageUrl && (
                <img
                  src={s.imageUrl}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover opacity-70"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <span
                className="absolute top-1 left-1 text-[8px] font-bold uppercase tracking-wider px-1 rounded text-white"
                style={{ background: color }}
              >
                {s.shotType ?? "scene"}
              </span>
              <span className="absolute bottom-1 left-1 text-[9px] font-mono text-white/90">
                {(s.endSec - s.startSec).toFixed(1)}s
              </span>
              {/* Right trim handle */}
              <div
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDragging({ kind: "trim", id: s.id });
                }}
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/20 opacity-0 group-hover:opacity-100 hover:bg-white/60"
              />
            </div>
          );
        })}
        {/* Playhead */}
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            setDragging({ kind: "head" });
          }}
          className="absolute top-0 bottom-0 w-0.5 bg-accent shadow-[0_0_10px_rgba(99,102,241,0.8)] cursor-ew-resize z-20"
          style={{ left: `${(time / total) * 100}%` }}
        >
          <div className="absolute -top-1 -left-[5px] size-3 rounded-full bg-accent border-2 border-background" />
        </div>
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
