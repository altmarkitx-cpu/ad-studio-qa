import { useEffect, useRef } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEditor } from "@/store/editor-store";
import type { TextAnchor, TransitionType } from "@/lib/types";

const TRANSITION_CLASS: Record<TransitionType, string> = {
  cut: "",
  fade: "animate-[fadeIn_500ms_ease-out]",
  slide: "animate-[slideIn_500ms_ease-out]",
  zoom: "animate-[zoomIn_700ms_ease-out]",
  "street-cut": "animate-[streetCut_180ms_steps(3,end)]",
  "luxury-fade": "animate-[luxuryFade_900ms_cubic-bezier(0.16,1,0.3,1)]",
  "glitch-drop": "animate-[glitchDrop_420ms_ease-out]",
  "hard-flash": "animate-[hardFlash_320ms_ease-out]",
};

export function PreviewCanvas() {
  const project = useEditor((s) => s.project)!;
  const activeId = useEditor((s) => s.activeSceneId);
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const setTime = useEditor((s) => s.setTime);
  const togglePlaying = useEditor((s) => s.togglePlaying);
  const setPlaying = useEditor((s) => s.setPlaying);

  const scenes = project.scenes;
  const total = project.durationSec || scenes[scenes.length - 1]?.endSec || 1;

  // Animation loop driven by shared playhead
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastRef.current = null;
      return;
    }
    const tick = (now: number) => {
      if (lastRef.current == null) lastRef.current = now;
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      const cur = useEditor.getState().time;
      const next = cur + dt;
      setTime(next >= total ? 0 : next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastRef.current = null;
    };
  }, [playing, total, setTime]);

  const scene = scenes.find((s) => s.id === activeId) ?? scenes[0];
  const accent = project.endCard.accentColor ?? "#6366f1";
  const transition = scene?.transitionType ?? "fade";
  const transitionClass = TRANSITION_CLASS[transition] ?? TRANSITION_CLASS.fade;
  const progress = Math.min(100, (time / total) * 100);
  const layout = scene?.formatLayouts?.["16:9"] ?? {};
  const headline = scene?.headline || project.script.headline;
  const subtitle = scene?.subtitle || scene?.caption || "";
  const bullets = scene?.bullets?.filter(Boolean) ?? [];
  const textSize = layout.textSize ?? 48;
  const subtitleSize = layout.subtitleSize ?? 18;
  const textColor = layout.textColor ?? "#ffffff";
  const textAlign = layout.textAlign ?? "left";
  const anchor = layout.textAnchor ?? "top-left";
  const imageScale = layout.imageScale ?? 1;
  const imageOpacity = layout.imageOpacity ?? 1;
  const overlayOpacity = layout.overlayOpacity ?? 0.55;

  return (
    <div className="space-y-3" style={{ width: "min(100%, 1120px, calc(54vh * 16 / 9))" }}>
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-panel shadow-2xl ring-1 ring-white/10">
        {scene?.imageUrl ? (
          <img
            key={scene.id}
            src={scene.imageUrl}
            alt=""
            className={`absolute inset-0 w-full h-full ${layout.imageFit === "contain" ? "object-contain" : "object-cover"} ${transitionClass}`}
            style={{
              opacity: imageOpacity,
              transform: `translate(${layout.imageX ?? 0}px, ${layout.imageY ?? 0}px) scale(${imageScale})`,
            }}
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 to-zinc-800" />
        )}
        <div
          className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-black/40"
          style={{ opacity: overlayOpacity }}
        />

        <div className="absolute inset-0 p-6 md:p-10">
          <div
            key={`h-${scene?.id}`}
            className={`absolute max-w-[70%] animate-[fadeIn_400ms_ease-out] ${anchorClass(anchor)}`}
            style={{ textAlign, color: textColor }}
          >
            <h2
              className="font-display leading-[0.92] tracking-tighter"
              style={{ fontSize: textSize, color: textColor }}
            >
              {headline}
            </h2>
            {subtitle && (
              <p
                className="mt-3 max-w-lg font-sans leading-tight text-white/85"
                style={{ fontSize: subtitleSize, color: textColor }}
              >
                {subtitle}
              </p>
            )}
            {bullets.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {bullets.map((bullet, index) => (
                  <p key={`${bullet}-${index}`} className="text-sm font-medium text-white/85">
                    {bullet}
                  </p>
                ))}
              </div>
            )}
            <div
              className={`mt-3 h-0.5 w-12 ${textAlign === "center" ? "mx-auto" : textAlign === "right" ? "ml-auto" : ""}`}
              style={{ background: accent }}
            />
          </div>

          <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between gap-3 md:bottom-10 md:left-10 md:right-10">
            <div className="bg-white/10 backdrop-blur-md p-3 md:p-4 rounded-lg border border-white/10 flex gap-3 max-w-md">
              {project.qrCodeDataUrl ? (
                <img src={project.qrCodeDataUrl} alt="QR" className="size-12 rounded-sm bg-white" />
              ) : (
                <div className="size-12 bg-white rounded-sm" />
              )}
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>
                  {project.script.cta}
                </p>
                <p className="text-xs text-white/80 font-medium truncate">
                  {project.script.bottomBannerText}
                </p>
              </div>
            </div>
            <div
              className="px-3 py-2 text-white font-mono text-[10px] rounded uppercase tracking-tighter shrink-0"
              style={{ background: accent }}
            >
              Scene {(scenes.findIndex((s) => s.id === scene?.id) + 1).toString().padStart(2, "0")} /{" "}
              {scenes.length.toString().padStart(2, "0")}
            </div>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
          <div
            className="h-full transition-[width] duration-100 ease-linear"
            style={{ width: `${progress}%`, background: accent }}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 px-1">
        <button
          onClick={togglePlaying}
          className="size-9 grid place-items-center rounded-full bg-white text-black hover:scale-105 transition"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4 ml-0.5" />}
        </button>
        <button
          onClick={() => {
            setTime(0);
            setPlaying(true);
          }}
          className="size-9 grid place-items-center rounded-full bg-white/5 text-white/70 hover:bg-white/10 transition"
          aria-label="Restart"
        >
          <RotateCcw className="size-4" />
        </button>
        <div className="font-mono text-[11px] text-white/60 tabular-nums">
          {time.toFixed(1)}s / {total.toFixed(1)}s
        </div>
        <input
          type="range"
          min={0}
          max={total}
          step={0.05}
          value={time}
          onChange={(e) => setTime(parseFloat(e.target.value))}
          className="flex-1 accent-accent"
        />
      </div>
    </div>
  );
}

function anchorClass(anchor: TextAnchor) {
  switch (anchor) {
    case "center":
      return "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2";
    case "bottom-center":
      return "bottom-28 left-1/2 -translate-x-1/2";
    case "bottom-left":
      return "bottom-28 left-6 md:left-10";
    case "top-left":
    default:
      return "left-6 top-6 md:left-10 md:top-10";
  }
}
