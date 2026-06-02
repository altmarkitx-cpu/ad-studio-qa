import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  Image as ImageIcon,
  Instagram,
  Mic2,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Volume2,
} from "lucide-react";
import gsap from "gsap";
import { useEditor } from "@/store/editor-store";
import { MUSIC_BEDS } from "@/lib/ad-presets";
import type { AdFormat, AdProject, Scene, TextAnchor } from "@/lib/types";

const FORMAT_CLASSES: Record<AdFormat, string> = {
  "16:9": "aspect-video w-full max-w-5xl",
  "9:16": "aspect-[9/16] h-full max-h-[68vh]",
  "1:1": "aspect-square h-full max-h-[68vh]",
};

type PreviewAudio = {
  context: AudioContext;
  gain: GainNode;
  timer: number;
  step: number;
  music?: HTMLAudioElement;
  voiceover?: HTMLAudioElement;
};
type ExportJob = {
  format: AdFormat;
  status: "pending" | "rendering" | "done" | "failed";
  file?: string;
  url?: string;
  container?: "mp4" | "webm";
  sizeBytes?: number;
  error?: string;
};

type PreflightItem = {
  id: string;
  label: string;
  state: "ready" | "warn";
  icon: "image" | "music" | "voice";
};

export function PreviewCanvas() {
  const project = useEditor((s) => s.project)!;
  const activeId = useEditor((s) => s.activeSceneId);
  const setActiveScene = useEditor((s) => s.setActiveScene);
  const patchScenes = useEditor((s) => s.patchScenes);
  const activeVariant = useEditor((s) =>
    s.variants.find((variant) => variant.id === s.activeVariantId),
  );
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const scene = useMemo(
    () =>
      project.scenes.find((s) => currentTime >= s.startSec && currentTime < s.endSec) ??
      project.scenes.find((s) => s.id === activeId) ??
      project.scenes.at(-1) ??
      project.scenes[0],
    [activeId, currentTime, project.scenes],
  );
  const sceneIndex = Math.max(
    0,
    project.scenes.findIndex((s) => s.id === scene?.id),
  );
  const [format, setFormat] = useState<AdFormat>("16:9");
  const frameRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const audioRef = useRef<PreviewAudio | null>(null);
  const exportUrlsRef = useRef<string[]>([]);
  const voiceStartedRef = useRef(false);
  const internalSceneChangeRef = useRef(false);
  const accent = project.endCard.accentColor ?? "#ffffff";
  const isVertical = format === "9:16";
  const isSquare = format === "1:1";
  const duration = project.durationSec || 20;
  const progress = Math.min(100, Math.max(0, (currentTime / duration) * 100));
  const preflight = useMemo(() => buildPreflight(project), [project]);

  useEffect(() => {
    if (!scene?.id || scene.id === activeId) return;
    internalSceneChangeRef.current = true;
    setActiveScene(scene.id);
  }, [activeId, scene?.id, setActiveScene]);

  useEffect(() => {
    if (!activeId || internalSceneChangeRef.current) {
      internalSceneChangeRef.current = false;
      return;
    }
    const active = project.scenes.find((s) => s.id === activeId);
    if (active && !isPlaying) setCurrentTime(active.startSec);
  }, [activeId, isPlaying, project.scenes]);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTickRef.current = null;
      return;
    }

    const tick = (now: number) => {
      if (lastTickRef.current == null) lastTickRef.current = now;
      const delta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      setCurrentTime((time) => {
        const next = Math.min(duration, time + delta);
        if (next >= duration) {
          setIsPlaying(false);
          stopPreviewAudio(audioRef.current);
          audioRef.current = null;
          voiceStartedRef.current = false;
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [duration, isPlaying]);

  useEffect(() => {
    if (!isPlaying || !audioEnabled) {
      stopPreviewAudio(audioRef.current);
      audioRef.current = null;
      if ("speechSynthesis" in window) window.speechSynthesis.pause();
      return;
    }

    audioRef.current = startPreviewAudio(
      audioRef.current,
      project.musicAudioDataUrl,
      project.voiceoverAudioDataUrl,
      project.musicBedId,
      project.musicEnabled !== false,
      project.musicVolume ?? 0.34,
      project.voiceoverEnabled !== false,
      project.voiceoverVolume ?? 0.9,
    );
    if (
      project.voiceoverEnabled !== false &&
      !project.voiceoverAudioDataUrl &&
      !voiceStartedRef.current
    ) {
      speakVoiceover(
        project.script.voiceoverScript,
        project.script.voiceProfile,
        project.voiceoverVolume ?? 0.9,
      );
      voiceStartedRef.current = true;
    } else if (
      project.voiceoverEnabled !== false &&
      !project.voiceoverAudioDataUrl &&
      "speechSynthesis" in window
    ) {
      window.speechSynthesis.resume();
    }

    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.pause();
    };
  }, [
    audioEnabled,
    isPlaying,
    project.musicAudioDataUrl,
    project.musicEnabled,
    project.musicVolume,
    project.voiceoverAudioDataUrl,
    project.voiceoverEnabled,
    project.voiceoverVolume,
    project.musicBedId,
    project.script.voiceProfile,
    project.script.voiceoverScript,
  ]);

  useEffect(() => {
    return () => {
      stopPreviewAudio(audioRef.current);
      revokeExportUrls(exportUrlsRef.current);
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    if (!frameRef.current || !copyRef.current) return;
    const ctx = gsap.context(() => {
      const preset = scene?.transitionPreset ?? "street-cut";
      if (imageRef.current) {
        gsap.fromTo(
          imageRef.current,
          {
            scale: preset === "hard-flash" ? 1.05 : 1,
            x: preset === "street-cut" ? -18 : 0,
            filter:
              preset === "hard-flash"
                ? "brightness(1.6) saturate(0.72) contrast(1.35) sepia(0.1)"
                : "saturate(0.86) contrast(1.16) sepia(0.08)",
          },
          {
            scale: 1.15,
            x: preset === "street-cut" ? 0 : preset === "glitch-drop" ? 10 : 0,
            filter: "brightness(1) saturate(0.78) contrast(1.26) sepia(0.16)",
            duration: 5,
            ease: preset === "luxury-fade" ? "power1.out" : "none",
          },
        );
      }

      const animated = copyRef.current!.querySelectorAll("[data-animate]");
      if (animated.length > 0) {
        gsap.fromTo(
          animated,
          { opacity: 0, y: 40, x: scene?.role === "hook" ? -28 : 0 },
          {
            opacity: 1,
            y: 0,
            x: 0,
            duration: 0.8,
            ease: "power3.out",
            stagger: 0.3,
          },
        );
      }

      const pop = copyRef.current!.querySelectorAll("[data-pop]");
      if (pop.length > 0) {
        gsap.fromTo(
          pop,
          { opacity: 0, scale: 0.55, y: 12 },
          {
            opacity: 1,
            scale: 1,
            y: 0,
            duration: 0.38,
            ease: "back.out(1.9)",
            stagger: 0.15,
            delay: 0.45,
          },
        );
      }
    }, frameRef);
    return () => ctx.revert();
  }, [scene?.id, scene?.role, scene?.transitionPreset, format]);

  const formatOptions = useMemo(() => project.formats ?? ["16:9", "9:16", "1:1"], [project]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4">
      <div className="flex w-full max-w-5xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/40 p-1">
          {formatOptions.map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={`h-7 px-3 rounded-full text-[10px] font-bold transition-colors ${
                format === f ? "bg-white text-black" : "text-white/55 hover:text-white"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAudioEnabled((next) => !next)}
            className={`h-8 rounded-full border px-3 text-[10px] font-bold uppercase tracking-widest transition-colors ${
              audioEnabled
                ? "border-white/15 bg-white/10 text-white"
                : "border-white/10 bg-black/30 text-white/45"
            }`}
            title="Toggle voiceover and music preview"
          >
            <Volume2 className="mr-1.5 inline size-3" />
            Audio
          </button>
          <button
            onClick={async () => {
              setExporting(true);
              revokeExportUrls(exportUrlsRef.current);
              exportUrlsRef.current = [];
              setExportJobs(
                orderedFormats(format).map((item) => ({ format: item, status: "pending" })),
              );
              try {
                await exportVideoPreview(project, format, activeVariant?.label, (job) => {
                  if (job.url) exportUrlsRef.current.push(job.url);
                  setExportJobs((jobs) =>
                    jobs.map((item) => (item.format === job.format ? { ...item, ...job } : item)),
                  );
                });
              } finally {
                setExporting(false);
              }
            }}
            disabled={exporting}
            className="h-8 rounded-full border border-white/15 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-black transition-transform hover:scale-[1.03]"
          >
            {exporting ? (
              <Sparkles className="mr-1.5 inline size-3 animate-spin" />
            ) : (
              <Download className="mr-1.5 inline size-3" />
            )}
            {exporting ? "Rendering" : "Render Queue"}
          </button>
        </div>
        <PreflightStrip items={preflight} />
        {exportJobs.length > 0 && (
          <div className="w-full rounded-xl border border-white/10 bg-black/45 p-3 text-[10px] uppercase tracking-widest text-white/65">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="font-bold text-white">Render queue</span>
              <div className="flex items-center gap-2">
                <span className="text-white/45">MP4 preferred · WebM fallback</span>
                {exportJobs.some((job) => job.url) && (
                  <button
                    onClick={() =>
                      exportJobs.forEach((job) => {
                        if (job.url && job.file) downloadObjectUrl(job.url, job.file);
                      })
                    }
                    className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[9px] font-black text-white transition-colors hover:bg-white/15"
                  >
                    Download all
                  </button>
                )}
              </div>
            </div>
            <div className="grid gap-1.5 md:grid-cols-3">
              {exportJobs.map((job) => (
                <div key={job.format} className="rounded-md bg-white/5 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-bold text-white">{job.format}</span>
                    {job.url && job.file ? (
                      <button
                        onClick={() => downloadObjectUrl(job.url!, job.file!)}
                        className="rounded-full bg-white px-2 py-1 text-[9px] font-black text-black transition-transform hover:scale-[1.03]"
                      >
                        Download
                      </button>
                    ) : null}
                  </div>
                  <span className={job.status === "failed" ? "text-red-300" : ""}>
                    {job.status}
                  </span>
                  {job.container && <span className="ml-2 text-white/45">{job.container}</span>}
                  {job.sizeBytes ? (
                    <span className="ml-2 text-white/45">{formatBytes(job.sizeBytes)}</span>
                  ) : null}
                  {job.file && <div className="mt-1 truncate text-accent">{job.file}</div>}
                  {job.error && <div className="mt-1 line-clamp-2 text-red-300">{job.error}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div
        ref={frameRef}
        className={`${FORMAT_CLASSES[format]} relative overflow-hidden bg-black shadow-2xl ring-1 ring-white/10 animate-slide-up`}
        style={{ borderRadius: format === "16:9" ? 14 : 22 }}
      >
        {scene?.role === "endcard" && project.endCard.enabled !== false ? (
          <EndCard scene={scene} accent={accent} isVertical={isVertical} />
        ) : (
          <ImageScene
            scene={scene}
            accent={accent}
            isVertical={isVertical}
            isSquare={isSquare}
            imageRef={imageRef}
            fallbackImageUrl={getFallbackImageUrl(project, scene)}
            brandName={project.brand.brandName}
          />
        )}

        <div ref={copyRef} className="absolute inset-0 pointer-events-none">
          {scene?.role === "hook" && (
            <HookCopy
              brandName={project.brand.brandName}
              scene={scene}
              format={format}
              websiteUrl={project.qrDestinationUrl ?? project.brand.websiteUrl}
              qrCodeDataUrl={project.qrEnabled === false ? "" : project.qrCodeDataUrl}
              showBottomCta={project.bottomBannerEnabled !== false}
              onScenePatch={(patch) =>
                scene && patchScenes((scenes) => patchScene(scenes, scene.id, patch))
              }
            />
          )}
          {scene?.role === "product" && (
            <ProductCopy
              scene={scene}
              accent={accent}
              format={format}
              onScenePatch={(patch) =>
                scene && patchScenes((scenes) => patchScene(scenes, scene.id, patch))
              }
            />
          )}
          {scene?.role === "proof" && (
            <ProofCopy
              scene={scene}
              accent={accent}
              format={format}
              onScenePatch={(patch) =>
                scene && patchScenes((scenes) => patchScene(scenes, scene.id, patch))
              }
            />
          )}
          {scene?.role !== "endcard" && scene?.caption && (
            <SceneCaption
              scene={scene}
              format={format}
              onScenePatch={(patch) =>
                scene && patchScenes((scenes) => patchScene(scenes, scene.id, patch))
              }
            />
          )}
        </div>

        <SceneDots total={project.scenes.length} active={sceneIndex} accent={accent} />
        <div className="absolute left-5 top-5 flex items-center gap-2 rounded-full bg-black/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/70 backdrop-blur-md">
          <Music2 className="size-3" />
          {project.musicGenre ?? "Lo-fi hip hop"}
        </div>
        <div className="absolute bottom-0 left-0 right-0 z-30 h-1 bg-white/15">
          <div className="h-full" style={{ width: `${progress}%`, backgroundColor: accent }} />
        </div>
      </div>

      <div className="w-full max-w-5xl rounded-xl border border-white/10 bg-black/45 p-3 shadow-xl">
        <div className="mb-3 flex items-center gap-3">
          <button
            onClick={() => {
              if (currentTime >= duration) setCurrentTime(0);
              setIsPlaying((next) => !next);
            }}
            className="grid size-10 shrink-0 place-items-center rounded-full text-black shadow-lg"
            style={{ backgroundColor: accent }}
          >
            {isPlaying ? (
              <Pause className="size-5 fill-black" />
            ) : (
              <Play className="size-5 fill-black" />
            )}
          </button>
          <button
            onClick={() => {
              setCurrentTime(0);
              setIsPlaying(false);
              voiceStartedRef.current = false;
              stopPreviewAudio(audioRef.current);
              audioRef.current = null;
              if ("speechSynthesis" in window) window.speechSynthesis.cancel();
            }}
            className="grid size-8 shrink-0 place-items-center rounded-full border border-white/10 text-white/70 hover:text-white"
          >
            <RotateCcw className="size-4" />
          </button>
          <div className="min-w-[80px] font-mono text-xs text-white/70">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.05}
            value={currentTime}
            onChange={(event) => {
              setCurrentTime(Number(event.target.value));
              voiceStartedRef.current = false;
              if ("speechSynthesis" in window) window.speechSynthesis.cancel();
            }}
            className="h-2 flex-1 cursor-pointer accent-white"
            aria-label="Video playhead"
          />
          <div className="hidden items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-white/55 md:flex">
            <span className="inline-flex items-center gap-1">
              <Mic2 className="size-3" />
              Voiceover
            </span>
            <span className="inline-flex items-center gap-1">
              <Music2 className="size-3" />
              Beat
            </span>
          </div>
        </div>
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${project.scenes.length}, minmax(0, 1fr))` }}
        >
          {project.scenes.map((item, index) => {
            const active = item.id === scene?.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setCurrentTime(item.startSec);
                  setActiveScene(item.id);
                }}
                className="h-2 overflow-hidden rounded-full bg-white/10 text-left"
                title={`Scene ${index + 1}`}
              >
                <span
                  className="block h-full rounded-full transition-all"
                  style={{
                    width: active ? "100%" : "0%",
                    backgroundColor: active ? accent : "rgba(255,255,255,.5)",
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ImageScene({
  scene,
  accent,
  isVertical,
  isSquare,
  imageRef,
  fallbackImageUrl,
  brandName,
}: {
  scene?: Scene;
  accent: string;
  isVertical: boolean;
  isSquare: boolean;
  imageRef: React.RefObject<HTMLImageElement | null>;
  fallbackImageUrl?: string;
  brandName: string;
}) {
  const objectPosition =
    scene?.formatLayouts?.[isVertical ? "9:16" : isSquare ? "1:1" : "16:9"]?.imageX ?? 50;
  const imageUrl = scene?.imageUrl || fallbackImageUrl;
  const renderableImageUrl = imageUrl ? toRenderableImageUrl(imageUrl) : "";
  const renderableFallbackUrl = fallbackImageUrl ? toRenderableImageUrl(fallbackImageUrl) : "";
  return (
    <>
      <div className="absolute inset-0 overflow-hidden bg-black">
        <div
          className="absolute inset-0 scale-110"
          style={{
            background: `radial-gradient(circle at 72% 24%, ${accent}44, transparent 32%), linear-gradient(135deg, #050506 0%, #151519 52%, #050506 100%)`,
          }}
        />
        <div
          className="absolute inset-0 opacity-35"
          style={{
            backgroundImage:
              "linear-gradient(115deg, transparent 0 18%, rgba(255,255,255,.08) 18% 18.5%, transparent 18.5% 36%, rgba(255,255,255,.06) 36% 36.5%, transparent 36.5% 100%)",
            backgroundSize: isVertical ? "180px 180px" : "260px 260px",
          }}
        />
        <div className="absolute bottom-10 left-10 right-10 text-white/18">
          <div
            className={`${isVertical ? "text-[54px] leading-[48px]" : isSquare ? "text-[56px] leading-[50px]" : "text-[72px] leading-[64px]"} font-black uppercase`}
            style={{ fontFamily: '"Inter Tight", Inter, sans-serif' }}
          >
            {brandName}
          </div>
        </div>
      </div>
      {imageUrl ? (
        <img
          key={imageUrl}
          ref={imageRef}
          src={renderableImageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: `${objectPosition}% center` }}
          onLoad={(e) => {
            e.currentTarget.style.display = "block";
          }}
          onError={(e) => {
            const img = e.currentTarget as HTMLImageElement;
            if (renderableFallbackUrl && img.dataset.fallbackTried !== "true") {
              img.dataset.fallbackTried = "true";
              img.src = renderableFallbackUrl;
              return;
            }
            img.style.display = "none";
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/0 via-black/20 to-black/52" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/82 to-transparent" />
      <div
        className="absolute inset-0 mix-blend-soft-light opacity-[0.18]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(255,255,255,.55) 0 1px, transparent 1px), radial-gradient(circle at 70% 60%, rgba(255,255,255,.35) 0 1px, transparent 1px)",
          backgroundSize: isVertical ? "22px 22px, 31px 31px" : "28px 28px, 39px 39px",
        }}
      />
      <div className="absolute inset-0" style={{ boxShadow: `inset 0 0 120px ${accent}22` }} />
    </>
  );
}

function getFallbackImageUrl(project: AdProject, scene?: Scene): string | undefined {
  return getSceneImageFallbacks(project, scene).find((url) => url !== scene?.imageUrl);
}

function getSceneImageFallbacks(project: AdProject, scene?: Scene): string[] {
  const screenshot = websiteScreenshotUrl(project.brand.websiteUrl || project.sourceUrl);
  const urls = [
    scene?.imageUrl,
    ...project.brand.selectedImages,
    ...project.brand.imageCandidates,
    ...project.scenes
      .filter((item) => item.imageUrl && item.role !== "endcard")
      .map((item) => item.imageUrl),
    screenshot,
  ].filter((url): url is string => Boolean(url));
  return Array.from(new Set(urls));
}

function toRenderableImageUrl(src: string): string {
  if (!src || /^(data:|blob:|\/api\/image\b)/i.test(src)) return src;
  if (!/^https?:\/\//i.test(src)) return src;
  return src;
}

function toRenderableAudioUrl(src: string): string {
  if (!src || /^(data:|blob:|\/api\/audio\b)/i.test(src)) return src;
  if (!/^https?:\/\//i.test(src)) return src;
  return `/api/audio?url=${encodeURIComponent(src)}`;
}

function websiteScreenshotUrl(url: string): string {
  return `https://image.thum.io/get/width/1400/crop/800/noanimate/${encodeURIComponent(url)}`;
}

function HookCopy({
  brandName,
  scene,
  format,
  websiteUrl,
  qrCodeDataUrl,
  showBottomCta,
  onScenePatch,
}: {
  brandName: string;
  scene?: Scene;
  format: AdFormat;
  websiteUrl: string;
  qrCodeDataUrl: string;
  showBottomCta: boolean;
  onScenePatch: (patch: Partial<Scene>) => void;
}) {
  const isVertical = format === "9:16";
  const isSquare = format === "1:1";
  const anchor = scene?.formatLayouts?.[format]?.textAnchor ?? "bottom-left";
  return (
    <>
      <div
        data-animate
        className={`${isVertical ? "left-7 top-9 text-[42px] leading-[38px]" : isSquare ? "left-9 top-9 text-[44px] leading-[40px]" : "left-10 top-8 text-[48px] leading-[43px]"} absolute font-normal text-white`}
        style={{
          fontFamily: '"Inter Tight", Inter, sans-serif',
          textShadow: "0 4px 30px rgba(0,0,0,0.35)",
        }}
      >
        {brandName}
      </div>
      <div className={`absolute ${textAnchorClass(anchor, format)}`}>
        <h2
          data-animate
          contentEditable
          suppressContentEditableWarning
          onBlur={(event) => onScenePatch({ headline: event.currentTarget.textContent ?? "" })}
          className={`${isVertical ? "text-[44px] leading-[40px]" : isSquare ? "text-[46px] leading-[42px]" : "text-[48px] leading-[43px]"} pointer-events-auto cursor-text font-normal text-white outline-none focus:ring-1 focus:ring-white/40`}
          style={{
            fontFamily: '"Inter Tight", Inter, sans-serif',
            textShadow: "0 4px 30px rgba(0,0,0,0.5)",
          }}
        >
          {scene?.headline}
        </h2>
        <p
          data-animate
          contentEditable
          suppressContentEditableWarning
          onBlur={(event) => onScenePatch({ subtitle: event.currentTarget.textContent ?? "" })}
          className={`${isVertical ? "mt-4 text-xl leading-6" : isSquare ? "mt-4 text-[22px] leading-7" : "mt-4 text-[24px] leading-7"} pointer-events-auto max-w-xl cursor-text font-light text-white/86 outline-none focus:ring-1 focus:ring-white/40`}
          style={{ textShadow: "0 4px 30px rgba(0,0,0,0.5)" }}
        >
          {scene?.subtitle}
        </p>
      </div>
      {showBottomCta && (
        <BottomCta
          format={format}
          qrCodeDataUrl={qrCodeDataUrl}
          brandName={brandName}
          websiteUrl={websiteUrl}
        />
      )}
    </>
  );
}

function ProductCopy({
  scene,
  accent,
  format,
  onScenePatch,
}: {
  scene?: Scene;
  accent: string;
  format: AdFormat;
  onScenePatch: (patch: Partial<Scene>) => void;
}) {
  const isVertical = format === "9:16";
  const isSquare = format === "1:1";
  return (
    <div
      className={`absolute ${
        isVertical
          ? "left-7 right-7 bottom-28"
          : isSquare
            ? "left-9 right-9 bottom-24"
            : "left-10 bottom-14 max-w-3xl"
      }`}
    >
      <h2
        data-animate
        contentEditable
        suppressContentEditableWarning
        onBlur={(event) => onScenePatch({ headline: event.currentTarget.textContent ?? "" })}
        className={`${isVertical ? "text-[42px] leading-[38px]" : isSquare ? "text-[44px] leading-[40px]" : "text-[48px] leading-[43px]"} pointer-events-auto cursor-text font-normal text-white outline-none focus:ring-1 focus:ring-white/40`}
        style={{
          fontFamily: '"Inter Tight", Inter, sans-serif',
          textShadow: "0 4px 30px rgba(0,0,0,0.5)",
        }}
      >
        {scene?.headline}
      </h2>
      <div className={`${isVertical ? "mt-6 space-y-4" : "mt-6 space-y-3"}`}>
        {(scene?.bullets ?? []).map((bullet, index) => (
          <div key={bullet} data-animate className="flex items-center gap-4 text-white">
            <span
              className="grid size-8 shrink-0 place-items-center rounded-full"
              style={{ backgroundColor: accent, color: readableText(accent) }}
            >
              <Check className="size-5" strokeWidth={3} />
            </span>
            <span
              contentEditable
              suppressContentEditableWarning
              onBlur={(event) => {
                const bullets = [...(scene?.bullets ?? [])];
                bullets[index] = event.currentTarget.textContent ?? "";
                onScenePatch({ bullets });
              }}
              className={`${isVertical ? "text-xl leading-6" : "text-[24px] leading-7"} pointer-events-auto cursor-text font-light outline-none focus:ring-1 focus:ring-white/40`}
            >
              {bullet}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProofCopy({
  scene,
  accent,
  format,
  onScenePatch,
}: {
  scene?: Scene;
  accent: string;
  format: AdFormat;
  onScenePatch: (patch: Partial<Scene>) => void;
}) {
  const isVertical = format === "9:16";
  const isSquare = format === "1:1";
  return (
    <div
      className={`absolute ${
        isVertical
          ? "left-7 right-7 bottom-28"
          : isSquare
            ? "left-9 right-9 bottom-24"
            : "left-10 bottom-14 max-w-4xl"
      }`}
    >
      <div className="mb-5 flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            data-pop
            className={`${isVertical ? "text-3xl" : "text-[34px]"} leading-none`}
            style={{ color: accent }}
          >
            ★
          </span>
        ))}
      </div>
      <h2
        data-animate
        contentEditable
        suppressContentEditableWarning
        onBlur={(event) => onScenePatch({ headline: event.currentTarget.textContent ?? "" })}
        className={`${isVertical ? "text-[42px] leading-[38px]" : isSquare ? "text-[44px] leading-[40px]" : "text-[48px] leading-[43px]"} pointer-events-auto cursor-text font-normal text-white outline-none focus:ring-1 focus:ring-white/40`}
        style={{
          fontFamily: '"Inter Tight", Inter, sans-serif',
          textShadow: "0 4px 30px rgba(0,0,0,0.5)",
        }}
      >
        {scene?.headline}
      </h2>
      <blockquote
        data-animate
        contentEditable
        suppressContentEditableWarning
        onBlur={(event) =>
          onScenePatch({ quote: (event.currentTarget.textContent ?? "").replace(/^"|"$/g, "") })
        }
        className={`${isVertical ? "mt-6 text-2xl leading-8" : "mt-6 text-[26px] leading-8"} pointer-events-auto max-w-2xl cursor-text font-light text-white/90 outline-none focus:ring-1 focus:ring-white/40`}
        style={{ textShadow: "0 4px 30px rgba(0,0,0,0.5)" }}
      >
        "{scene?.quote}"
      </blockquote>
      <p data-animate className="mt-4 text-lg font-bold" style={{ color: accent }}>
        {scene?.reviewer}
      </p>
    </div>
  );
}

function BottomCta({
  format,
  qrCodeDataUrl,
  brandName,
  websiteUrl,
}: {
  format: AdFormat;
  qrCodeDataUrl: string;
  brandName: string;
  websiteUrl: string;
}) {
  const compact = format !== "16:9";
  return (
    <div
      data-animate
      className={`absolute ${
        compact ? "left-6 right-6 bottom-6" : "left-8 bottom-8 w-[285px]"
      } flex items-center gap-3 rounded-lg border border-white/15 bg-black/35 p-3 text-white shadow-2xl backdrop-blur-md`}
    >
      {qrCodeDataUrl && <img src={qrCodeDataUrl} alt="" className="size-14 rounded bg-white p-1" />}
      <div className="min-w-0">
        <p className="text-[11px] font-black uppercase leading-none tracking-widest">Visit now</p>
        <p className="mt-1 truncate text-[11px] font-bold text-white/78">
          {brandName} - {formatUrl(websiteUrl)}
        </p>
      </div>
    </div>
  );
}

function SceneCaption({
  scene,
  format,
  onScenePatch,
}: {
  scene: Scene;
  format: AdFormat;
  onScenePatch: (patch: Partial<Scene>) => void;
}) {
  const compact = format !== "16:9";
  return (
    <div
      data-animate
      className={`absolute left-1/2 z-20 -translate-x-1/2 ${
        compact ? "bottom-[92px] w-[86%]" : "bottom-[92px] w-[58%]"
      }`}
    >
      <p
        contentEditable
        suppressContentEditableWarning
        onBlur={(event) => onScenePatch({ caption: event.currentTarget.textContent ?? "" })}
        className={`${compact ? "text-[17px] leading-[22px]" : "text-[20px] leading-[25px]"} pointer-events-auto cursor-text rounded-md bg-black/38 px-4 py-2 text-center font-semibold text-white shadow-2xl outline-none backdrop-blur-md focus:ring-1 focus:ring-white/40`}
        style={{
          fontFamily: '"Inter Tight", Inter, sans-serif',
          textShadow: "0 4px 24px rgba(0,0,0,0.65)",
        }}
      >
        {scene.caption}
      </p>
    </div>
  );
}

function EndCard({
  scene,
  accent,
  isVertical,
}: {
  scene?: Scene;
  accent: string;
  isVertical: boolean;
}) {
  const project = useEditor((s) => s.project)!;
  const handle =
    project.endCard.socialHandles?.instagram ??
    `@${project.brand.brandName.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  return (
    <div className="absolute inset-0 grid place-items-center" style={{ backgroundColor: accent }}>
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(0,0,0,.52),rgba(0,0,0,.08)_45%,rgba(255,255,255,.12))]" />
      <div
        className="absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,.75) 0 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      />
      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center px-10 text-center text-white">
        {project.endCard.logoUrl ? (
          <img
            src={project.endCard.logoUrl}
            alt={project.endCard.companyName}
            className={`${isVertical ? "max-h-24 max-w-64" : "max-h-24 max-w-80"} mb-8 object-contain brightness-0 invert`}
          />
        ) : (
          <div
            className={`${isVertical ? "text-5xl" : "text-7xl"} mb-8 font-black uppercase tracking-normal`}
          >
            {project.endCard.companyName}
          </div>
        )}
        <h2
          data-animate
          className={`${isVertical ? "text-6xl" : "text-[72px]"} font-black uppercase leading-none`}
        >
          {scene?.headline}
        </h2>
        <button
          data-animate
          className="pointer-events-auto mt-9 inline-flex items-center gap-3 rounded-full bg-white px-8 py-4 text-lg font-black uppercase text-black shadow-2xl shadow-black/25"
        >
          <Play className="size-5 fill-black" />
          Shop Now →
        </button>
        <p data-animate className="mt-5 text-lg font-semibold text-white/86">
          {project.endCard.websiteUrl}
        </p>
        <div
          data-animate
          className="mt-7 flex flex-wrap items-center justify-center gap-5 text-sm font-bold text-white/82"
        >
          <span className="inline-flex items-center gap-2">
            <Instagram className="size-4" /> {handle}
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="grid size-4 place-items-center rounded bg-white text-[9px] font-black text-black">
              TT
            </span>
            {project.endCard.socialHandles?.tiktok ?? handle}
          </span>
        </div>
      </div>
      {project.qrEnabled !== false && project.qrCodeDataUrl && (
        <img
          src={project.qrCodeDataUrl}
          alt="QR code"
          className="absolute bottom-7 right-7 size-24 rounded-md bg-white p-2 shadow-xl"
        />
      )}
    </div>
  );
}

function SceneDots({ total, active, accent }: { total: number; active: number; accent: string }) {
  return (
    <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className="h-1.5 rounded-full transition-all"
          style={{
            width: i === active ? 28 : 7,
            backgroundColor: i === active ? accent : "rgba(255,255,255,.36)",
          }}
        />
      ))}
    </div>
  );
}

function patchScene(scenes: Scene[], id: string, patch: Partial<Scene>): Scene[] {
  return scenes.map((scene) => (scene.id === id ? { ...scene, ...patch } : scene));
}

function textAnchorClass(anchor: TextAnchor, format: AdFormat) {
  const vertical = format === "9:16";
  if (anchor === "top-left") return vertical ? "left-7 right-7 top-28" : "left-10 top-24 max-w-3xl";
  if (anchor === "center") return "left-8 right-8 top-1/2 -translate-y-1/2 text-center";
  if (anchor === "bottom-center") {
    return vertical
      ? "left-7 right-7 bottom-32 text-center"
      : "left-10 right-10 bottom-16 text-center";
  }
  if (format === "9:16") return "left-7 right-7 bottom-32";
  if (format === "1:1") return "left-9 right-9 bottom-28";
  return "left-10 bottom-16 max-w-[720px]";
}

function readableText(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return "#000000";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 140 ? "#000000" : "#ffffff";
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const min = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60)
    .toString()
    .padStart(2, "0");
  return `${min}:${sec}`;
}

function speakVoiceover(script: string, profile: string, volume: number) {
  if (!("speechSynthesis" in window) || !script.trim()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(script);
  utterance.rate = /energetic|young/i.test(profile) ? 0.98 : 0.9;
  utterance.pitch = /deep|cinematic/i.test(profile) ? 0.82 : 0.96;
  utterance.volume = clampVolume(volume);
  const voices = window.speechSynthesis.getVoices();
  const deepVoice =
    voices.find((voice) =>
      /google.*english.*male|microsoft.*guy|microsoft.*david/i.test(voice.name),
    ) ??
    voices.find((voice) => /google.*english|microsoft.*mark|daniel|david/i.test(voice.name)) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en"));
  if (deepVoice) utterance.voice = deepVoice;
  window.speechSynthesis.speak(utterance);
}

function startPreviewAudio(
  existing: PreviewAudio | null,
  musicAudioDataUrl?: string,
  voiceoverAudioDataUrl?: string,
  musicBedId?: string,
  musicEnabled = true,
  musicVolume = 0.34,
  voiceoverEnabled = true,
  voiceoverVolume = 0.9,
): PreviewAudio {
  if (existing) {
    void existing.context.resume();
    existing.gain.gain.setTargetAtTime(
      musicEnabled ? clampVolume(musicVolume) * 0.35 : 0.0001,
      existing.context.currentTime,
      0.04,
    );
    if (existing.music) {
      existing.music.volume = musicEnabled ? clampVolume(musicVolume) : 0;
      if (musicEnabled) void existing.music.play();
    }
    if (existing.voiceover) {
      existing.voiceover.volume = voiceoverEnabled ? clampVolume(voiceoverVolume) : 0;
      if (voiceoverEnabled) void existing.voiceover.play();
    }
    return existing;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  const gain = context.createGain();
  gain.gain.value = musicEnabled ? clampVolume(musicVolume) * 0.35 : 0.0001;
  gain.connect(context.destination);

  const audio: PreviewAudio = {
    context,
    gain,
    timer: 0,
    step: 0,
  };

  const bed = MUSIC_BEDS.find((item) => item.id === musicBedId);
  const intervalMs = bed ? Math.round(60000 / bed.bpm / 2) : 240;

  const scheduleBeat = () => {
    const now = context.currentTime;
    const isKick = audio.step % 4 === 0;
    const isSnare = audio.step % 8 === 4;
    const isHat = audio.step % 2 === 1;

    if (!musicEnabled) return;
    if (isKick) playTone(context, gain, 58, 0.12, 0.22, "sine");
    if (isSnare) playNoise(context, gain, 0.055, 0.09);
    if (isHat) playTone(context, gain, 7200, 0.018, 0.035, "triangle");
    if (audio.step % 16 === 0 || audio.step % 16 === 10) {
      playTone(context, gain, audio.step % 16 === 0 ? 110 : 98, 0.08, 0.35, "sawtooth");
    }

    audio.step += 1;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(clampVolume(musicVolume) * 0.35, now, 0.04);
  };

  scheduleBeat();
  if (musicEnabled) audio.timer = window.setInterval(scheduleBeat, intervalMs);

  if (musicEnabled && musicAudioDataUrl) {
    const music = new Audio(toRenderableAudioUrl(musicAudioDataUrl));
    music.loop = true;
    music.volume = clampVolume(musicVolume);
    void music.play();
    audio.music = music;
  }

  if (voiceoverEnabled && voiceoverAudioDataUrl) {
    const voiceover = new Audio(toRenderableAudioUrl(voiceoverAudioDataUrl));
    voiceover.volume = clampVolume(voiceoverVolume);
    void voiceover.play();
    audio.voiceover = voiceover;
  }

  return audio;
}

function stopPreviewAudio(audio: PreviewAudio | null) {
  if (!audio) return;
  window.clearInterval(audio.timer);
  if (audio.music) {
    audio.music.pause();
    audio.music.currentTime = 0;
  }
  if (audio.voiceover) {
    audio.voiceover.pause();
    audio.voiceover.currentTime = 0;
  }
  audio.gain.gain.setTargetAtTime(0.0001, audio.context.currentTime, 0.03);
  window.setTimeout(() => void audio.context.close(), 120);
}

function playTone(
  context: AudioContext,
  destination: AudioNode,
  frequency: number,
  volume: number,
  duration: number,
  type: OscillatorType,
) {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
  osc.connect(gain);
  gain.connect(destination);
  osc.start();
  osc.stop(context.currentTime + duration);
}

function playNoise(
  context: AudioContext,
  destination: AudioNode,
  volume: number,
  duration: number,
) {
  const bufferSize = context.sampleRate * duration;
  const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const output = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) output[i] = Math.random() * 2 - 1;

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  filter.type = "highpass";
  filter.frequency.value = 1600;
  gain.gain.setValueAtTime(volume, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
  source.buffer = buffer;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start();
}

function orderedFormats(format: AdFormat): AdFormat[] {
  return [format, ...(["16:9", "9:16", "1:1"] as const).filter((item) => item !== format)];
}

function buildPreflight(project: AdProject): PreflightItem[] {
  const sceneCount = project.scenes.length;
  const imageCount = project.scenes.filter((scene) => Boolean(scene.imageUrl)).length;
  const dataImageCount = project.scenes.filter((scene) =>
    /^data:image\//i.test(scene.imageUrl),
  ).length;
  const hasRealMusic = project.musicEnabled === false || Boolean(project.musicAudioDataUrl);
  const hasExportVoice =
    project.voiceoverEnabled === false || Boolean(project.voiceoverAudioDataUrl);

  return [
    {
      id: "images",
      icon: "image",
      state:
        imageCount === sceneCount && dataImageCount >= Math.min(sceneCount, 2) ? "ready" : "warn",
      label:
        imageCount === sceneCount
          ? dataImageCount >= Math.min(sceneCount, 2)
            ? "Images locked"
            : "Images use live URLs"
          : "Missing scene image",
    },
    {
      id: "music",
      icon: "music",
      state: hasRealMusic ? "ready" : "warn",
      label: hasRealMusic ? "Music export ready" : "Generated beat only",
    },
    {
      id: "voice",
      icon: "voice",
      state: hasExportVoice ? "ready" : "warn",
      label: hasExportVoice ? "Voice export ready" : "Preview voice only",
    },
  ];
}

function PreflightStrip({ items }: { items: PreflightItem[] }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5">
      {items.map((item) => {
        const Icon = item.icon === "image" ? ImageIcon : item.icon === "music" ? Music2 : Mic2;
        return (
          <span
            key={item.id}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[9px] font-black uppercase tracking-widest ${
              item.state === "ready"
                ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100"
                : "border-amber-400/25 bg-amber-400/10 text-amber-100"
            }`}
          >
            {item.state === "ready" ? (
              <Check className="size-3" />
            ) : (
              <AlertTriangle className="size-3" />
            )}
            <Icon className="size-3" />
            {item.label}
          </span>
        );
      })}
    </div>
  );
}

async function exportVideoPreview(
  project: AdProject,
  format: AdFormat,
  variantLabel?: string,
  onProgress?: (job: Partial<ExportJob> & { format: AdFormat }) => void,
) {
  for (const nextFormat of orderedFormats(format)) {
    onProgress?.({ format: nextFormat, status: "rendering" });
    try {
      const result = await exportOneVideo(project, nextFormat, variantLabel);
      onProgress?.({ format: nextFormat, status: "done", ...result });
    } catch (error) {
      onProgress?.({
        format: nextFormat,
        status: "failed",
        error: error instanceof Error ? error.message : "Render failed",
      });
    }
  }
}

async function exportOneVideo(
  project: AdProject,
  format: AdFormat,
  variantLabel?: string,
): Promise<{ file: string; url: string; container: "mp4" | "webm"; sizeBytes: number }> {
  const { width, height } = getExportSize(format);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas export is not available in this browser.");

  const mimeType = pickRecordingMime();
  const stream = canvas.captureStream(30);
  const audio = await createExportAudio(
    project.musicAudioDataUrl,
    project.voiceoverAudioDataUrl,
    project.musicBedId,
    project.musicEnabled !== false,
    project.musicVolume ?? 0.34,
    project.voiceoverEnabled !== false,
    project.voiceoverVolume ?? 0.9,
  );
  const audioTrack = audio.destination.stream.getAudioTracks()[0];
  if (audioTrack) stream.addTrack(audioTrack);
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const images = await Promise.all(
    project.scenes.map((scene) => loadFirstAvailableImage(getSceneImageFallbacks(project, scene))),
  );
  const qr =
    project.qrEnabled !== false && project.qrCodeDataUrl
      ? await loadImage(project.qrCodeDataUrl)
      : null;
  const logo = project.endCard.logoUrl ? await loadImage(project.endCard.logoUrl) : null;
  const start = performance.now();
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || recorder.mimeType }));
  });

  recorder.start();
  audio.start();

  await new Promise<void>((resolve) => {
    const frame = (now: number) => {
      const time = Math.min(project.durationSec, (now - start) / 1000);
      renderExportFrame(ctx, project, images, qr, logo, format, time);
      if (time < project.durationSec) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });

  recorder.stop();
  audio.stop();
  const blob = await done;
  const container = (mimeType || recorder.mimeType).includes("mp4") ? "mp4" : "webm";
  const extension = container;
  const url = URL.createObjectURL(blob);
  const variantSlug = variantLabel
    ? `-${variantLabel
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()}`
    : "";
  const filename = `${project.brand.brandName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}${variantSlug}-${format.replace(":", "x")}.${extension}`;
  return { file: filename, url, container, sizeBytes: blob.size };
}

function downloadObjectUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

function revokeExportUrls(urls: string[]) {
  urls.forEach((url) => URL.revokeObjectURL(url));
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function pickRecordingMime(): string {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function getExportSize(format: AdFormat): { width: number; height: number } {
  if (format === "9:16") return { width: 1080, height: 1920 };
  if (format === "1:1") return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

async function loadFirstAvailableImage(srcs: string[]): Promise<HTMLImageElement | null> {
  for (const src of srcs) {
    const image = await loadImage(src);
    if (image) return image;
  }
  return null;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = toRenderableImageUrl(src);
  });
}

async function createExportAudio(
  musicAudioDataUrl?: string,
  voiceoverAudioDataUrl?: string,
  musicBedId?: string,
  musicEnabled = true,
  musicVolume = 0.34,
  voiceoverEnabled = true,
  voiceoverVolume = 0.9,
) {
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  let timer = 0;
  let step = 0;
  let musicSource: AudioBufferSourceNode | null = null;
  let voiceoverSource: AudioBufferSourceNode | null = null;

  if (musicEnabled && musicAudioDataUrl) {
    try {
      const buffer = await fetch(toRenderableAudioUrl(musicAudioDataUrl))
        .then((res) => res.arrayBuffer())
        .then((data) => context.decodeAudioData(data));
      musicSource = context.createBufferSource();
      const musicGain = context.createGain();
      musicGain.gain.value = clampVolume(musicVolume);
      musicSource.buffer = buffer;
      musicSource.loop = true;
      musicSource.connect(musicGain);
      musicGain.connect(destination);
    } catch (error) {
      console.warn("[export] music bed decode failed, using generated beat", error);
    }
  }

  if (voiceoverEnabled && voiceoverAudioDataUrl) {
    try {
      const buffer = await fetch(toRenderableAudioUrl(voiceoverAudioDataUrl))
        .then((res) => res.arrayBuffer())
        .then((data) => context.decodeAudioData(data));
      voiceoverSource = context.createBufferSource();
      const voiceGain = context.createGain();
      voiceGain.gain.value = clampVolume(voiceoverVolume);
      voiceoverSource.buffer = buffer;
      voiceoverSource.connect(voiceGain);
      voiceGain.connect(destination);
    } catch (error) {
      console.warn("[export] voiceover decode failed", error);
    }
  }

  const schedule = () => {
    if (musicEnabled && !musicSource) {
      if (step % 4 === 0)
        playTone(context, destination, 58, 0.11 * clampVolume(musicVolume), 0.18, "sine");
      if (step % 8 === 4) playNoise(context, destination, 0.05 * clampVolume(musicVolume), 0.08);
      if (step % 2 === 1)
        playTone(context, destination, 6000, 0.016 * clampVolume(musicVolume), 0.025, "triangle");
    }
    step += 1;
  };
  const bed = MUSIC_BEDS.find((item) => item.id === musicBedId);
  const intervalMs = bed ? Math.round(60000 / bed.bpm / 2) : 240;
  return {
    destination,
    start: () => {
      musicSource?.start();
      voiceoverSource?.start();
      schedule();
      timer = window.setInterval(schedule, intervalMs);
    },
    stop: () => {
      window.clearInterval(timer);
      try {
        musicSource?.stop();
      } catch {
        // Source may already have ended.
      }
      try {
        voiceoverSource?.stop();
      } catch {
        // Source may already have ended.
      }
      void context.close();
    },
  };
}

function renderExportFrame(
  ctx: CanvasRenderingContext2D,
  project: AdProject,
  images: Array<HTMLImageElement | null>,
  qr: HTMLImageElement | null,
  logo: HTMLImageElement | null,
  format: AdFormat,
  time: number,
) {
  const { width, height } = ctx.canvas;
  const foundIndex = project.scenes.findIndex(
    (candidate) => time >= candidate.startSec && time < candidate.endSec,
  );
  const sceneIndex = foundIndex >= 0 ? foundIndex : project.scenes.length - 1;
  const scene = project.scenes[sceneIndex] ?? project.scenes[0];
  const image = images[sceneIndex] ?? images.find((candidate) => candidate) ?? null;
  const nextScene = project.scenes[sceneIndex + 1];
  const nextImage = nextScene ? (images[sceneIndex + 1] ?? image) : null;
  const localTime = Math.max(0, time - scene.startSec);
  const sceneDuration = Math.max(0.1, scene.endSec - scene.startSec);
  const transitionDuration = Math.min(0.6, sceneDuration * 0.35);
  const transitionProgress =
    nextScene && localTime > sceneDuration - transitionDuration
      ? Math.min(1, (localTime - (sceneDuration - transitionDuration)) / transitionDuration)
      : 0;
  const accent = project.endCard.accentColor ?? "#f97316";
  const showEndCard = scene.role === "endcard" && project.endCard.enabled !== false;

  ctx.fillStyle = showEndCard ? accent : "#050506";
  ctx.fillRect(0, 0, width, height);
  drawExportBackgroundLayer(ctx, project, scene, image, format, localTime, accent, showEndCard);
  if (nextScene && transitionProgress > 0) {
    drawExportTransitionLayer(
      ctx,
      project,
      scene,
      nextScene,
      nextImage,
      format,
      transitionProgress,
      accent,
    );
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "rgba(0,0,0,.56)");
  gradient.addColorStop(0.48, "rgba(0,0,0,.18)");
  gradient.addColorStop(1, "rgba(0,0,0,.86)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  drawExportSceneCopy(ctx, project, scene, qr, logo, format, accent, showEndCard, localTime);
  ctx.fillStyle = "rgba(255,255,255,.2)";
  ctx.fillRect(0, height - 8, width, 8);
  ctx.fillStyle = accent;
  ctx.fillRect(0, height - 8, width * (time / project.durationSec), 8);
}

function drawExportSceneCopy(
  ctx: CanvasRenderingContext2D,
  project: AdProject,
  scene: Scene,
  qr: HTMLImageElement | null,
  logo: HTMLImageElement | null,
  format: AdFormat,
  accent: string,
  showEndCard: boolean,
  localTime: number,
) {
  if (showEndCard) {
    drawExportEndCard(ctx, project, scene, qr, logo, format, accent, localTime);
    return;
  }

  drawExportBrandMark(ctx, project, format, localTime);
  if (scene.role === "product") {
    drawExportProductCopy(ctx, project, scene, format, accent, localTime);
  } else if (scene.role === "proof") {
    drawExportProofCopy(ctx, project, scene, format, accent, localTime);
  } else {
    drawExportHookCopy(ctx, project, scene, format, localTime);
  }
  drawExportCaption(ctx, scene, format, localTime);
  if (project.bottomBannerEnabled !== false) drawExportCta(ctx, project, qr, format, localTime);
}

function drawExportBrandMark(
  ctx: CanvasRenderingContext2D,
  project: AdProject,
  format: AdFormat,
  localTime: number,
) {
  const { width, height } = ctx.canvas;
  const reveal = exportReveal(localTime, 0, 0.65);
  ctx.save();
  ctx.globalAlpha = reveal.alpha;
  ctx.translate(0, reveal.y * 0.42);
  ctx.fillStyle = "rgba(255,255,255,.95)";
  ctx.shadowColor = "rgba(0,0,0,.5)";
  ctx.shadowBlur = 30;
  ctx.font = `400 ${Math.round(format === "9:16" ? width * 0.09 : width * 0.044)}px "Inter Tight", Inter, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(project.brand.brandName, width * 0.05, height * 0.1);
  ctx.restore();
}

function drawExportHookCopy(
  ctx: CanvasRenderingContext2D,
  project: AdProject,
  scene: Scene,
  format: AdFormat,
  localTime: number,
) {
  const { width, height } = ctx.canvas;
  const headlineSize =
    format === "9:16" ? width * 0.12 : format === "1:1" ? width * 0.082 : width * 0.052;
  const anchor = scene.formatLayouts?.[format]?.textAnchor ?? "bottom-left";
  const center = anchor === "center" || anchor === "bottom-center";
  const x = center ? width * 0.5 : width * 0.05;
  const y =
    anchor === "top-left" ? height * 0.2 : anchor === "center" ? height * 0.46 : height * 0.66;
  const maxWidth = center ? width * 0.8 : width * (format === "16:9" ? 0.64 : 0.86);

  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,.5)";
  ctx.shadowBlur = 30;
  ctx.textAlign = center ? "center" : "left";
  drawAnimatedTextBlock(
    ctx,
    () => {
      ctx.font = `400 ${headlineSize}px "Inter Tight", Inter, sans-serif`;
      drawWrappedText(
        ctx,
        scene.headline || project.script.headline,
        x,
        y,
        maxWidth,
        headlineSize * 0.92,
        2,
      );
    },
    localTime,
    0.18,
    center ? 0 : -40,
  );
  drawAnimatedTextBlock(
    ctx,
    () => {
      ctx.font = `300 ${headlineSize * 0.48}px "Inter Tight", Inter, sans-serif`;
      drawWrappedText(
        ctx,
        scene.subtitle || project.brand.metaDescription || project.script.bottomBannerText,
        x,
        y + headlineSize * 1.42,
        maxWidth * 0.92,
        headlineSize * 0.62,
        3,
      );
    },
    localTime,
    0.5,
    center ? 0 : -24,
  );
  ctx.restore();
}

function drawExportProductCopy(
  ctx: CanvasRenderingContext2D,
  project: AdProject,
  scene: Scene,
  format: AdFormat,
  accent: string,
  localTime: number,
) {
  const { width, height } = ctx.canvas;
  const headlineSize =
    format === "9:16" ? width * 0.102 : format === "1:1" ? width * 0.074 : width * 0.046;
  const x = width * 0.055;
  const y = format === "9:16" ? height * 0.52 : height * 0.54;
  const maxWidth = format === "16:9" ? width * 0.56 : width * 0.86;
  const bullets =
    scene.bullets && scene.bullets.length > 0
      ? scene.bullets
      : [
          "Premium materials and detail",
          "Designed for everyday momentum",
          "A sharper way to show up",
        ];

  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,.52)";
  ctx.shadowBlur = 30;
  ctx.textAlign = "left";
  drawAnimatedTextBlock(
    ctx,
    () => {
      ctx.font = `400 ${headlineSize}px "Inter Tight", Inter, sans-serif`;
      drawWrappedText(
        ctx,
        scene.headline || project.script.headline,
        x,
        y,
        maxWidth,
        headlineSize * 0.94,
        2,
      );
    },
    localTime,
    0.16,
    -26,
  );

  const bulletSize = headlineSize * (format === "9:16" ? 0.46 : 0.42);
  const gap = bulletSize * 1.55;
  const startY = y + headlineSize * 1.42;
  bullets.slice(0, 4).forEach((bullet, index) => {
    const reveal = exportReveal(localTime, 0.58 + index * 0.34, 0.52);
    if (reveal.alpha <= 0) return;
    const cy = startY + index * gap;
    ctx.save();
    ctx.globalAlpha = reveal.alpha;
    ctx.translate(0, reveal.y);
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x + bulletSize * 0.5, cy - bulletSize * 0.22, bulletSize * 0.44, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(4, bulletSize * 0.1);
    ctx.beginPath();
    ctx.moveTo(x + bulletSize * 0.28, cy - bulletSize * 0.22);
    ctx.lineTo(x + bulletSize * 0.45, cy - bulletSize * 0.05);
    ctx.lineTo(x + bulletSize * 0.72, cy - bulletSize * 0.42);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.shadowBlur = 24;
    ctx.font = `300 ${bulletSize}px "Inter Tight", Inter, sans-serif`;
    drawWrappedText(ctx, bullet, x + bulletSize * 1.35, cy, maxWidth, bulletSize * 1.1, 1);
    ctx.restore();
  });
  ctx.restore();
}

function drawExportProofCopy(
  ctx: CanvasRenderingContext2D,
  project: AdProject,
  scene: Scene,
  format: AdFormat,
  accent: string,
  localTime: number,
) {
  const { width, height } = ctx.canvas;
  const headlineSize =
    format === "9:16" ? width * 0.095 : format === "1:1" ? width * 0.07 : width * 0.045;
  const x = format === "16:9" ? width * 0.055 : width * 0.075;
  const y = format === "9:16" ? height * 0.55 : height * 0.58;
  const maxWidth = format === "16:9" ? width * 0.58 : width * 0.84;

  ctx.save();
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,.55)";
  ctx.shadowBlur = 30;
  ctx.textAlign = "left";
  drawAnimatedTextBlock(
    ctx,
    () => {
      ctx.font = `400 ${headlineSize}px "Inter Tight", Inter, sans-serif`;
      drawWrappedText(
        ctx,
        scene.headline || project.script.headline,
        x,
        y,
        maxWidth,
        headlineSize * 0.92,
        2,
      );
    },
    localTime,
    0.16,
    -24,
  );

  const starSize = headlineSize * 0.5;
  const starY = y + headlineSize * 1.32;
  ctx.shadowBlur = 18;
  for (let i = 0; i < 5; i += 1) {
    const reveal = exportReveal(localTime, 0.52 + i * 0.14, 0.28);
    if (reveal.alpha <= 0) continue;
    ctx.save();
    ctx.globalAlpha = reveal.alpha;
    ctx.translate(0, reveal.y * 0.45);
    drawStar(ctx, x + i * starSize * 1.18, starY, starSize * (0.32 + reveal.alpha * 0.1), accent);
    ctx.restore();
  }

  const boxY = starY + starSize * 0.9;
  const boxHeight = format === "9:16" ? height * 0.14 : height * 0.12;
  drawAnimatedTextBlock(
    ctx,
    () => {
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(12,12,12,.56)";
      roundRect(ctx, x - width * 0.012, boxY, maxWidth, boxHeight, 16);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.18)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = `300 ${headlineSize * 0.43}px "Inter Tight", Inter, sans-serif`;
      drawWrappedText(
        ctx,
        scene.quote ? `"${scene.quote.replace(/^"|"$/g, "")}"` : "Real customers. Real results.",
        x + width * 0.018,
        boxY + boxHeight * 0.38,
        maxWidth * 0.9,
        headlineSize * 0.52,
        2,
      );
      ctx.font = `700 ${headlineSize * 0.28}px Inter, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,.86)";
      ctx.fillText(scene.reviewer || "@customer", x + width * 0.018, boxY + boxHeight * 0.82);
    },
    localTime,
    1.08,
    24,
  );
  ctx.restore();
}

function drawExportCaption(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  format: AdFormat,
  localTime: number,
) {
  const caption = scene.caption?.trim();
  if (!caption) return;
  const { width, height } = ctx.canvas;
  const compact = format !== "16:9";
  const fontSize = Math.round(compact ? width * 0.038 : width * 0.019);
  const maxWidth = compact ? width * 0.78 : width * 0.54;
  const lineHeight = fontSize * 1.22;
  const x = width * 0.5;
  const y = compact ? height * 0.79 : height * 0.78;
  const reveal = exportReveal(localTime, 0.82, 0.46);
  if (reveal.alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = reveal.alpha;
  ctx.translate(0, reveal.y * 0.35);
  ctx.textAlign = "center";
  ctx.font = `600 ${fontSize}px "Inter Tight", Inter, sans-serif`;
  const lines = wrapTextLines(ctx, caption, maxWidth, 2);
  const boxHeight = lines.length * lineHeight + fontSize * 0.9;
  const boxWidth = maxWidth + fontSize * 1.7;
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(0,0,0,.42)";
  roundRect(ctx, x - boxWidth / 2, y - fontSize * 0.8, boxWidth, boxHeight, 12);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,.7)";
  ctx.shadowBlur = 24;
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
  ctx.restore();
}

function drawExportEndCard(
  ctx: CanvasRenderingContext2D,
  project: AdProject,
  scene: Scene,
  qr: HTMLImageElement | null,
  logo: HTMLImageElement | null,
  format: AdFormat,
  accent: string,
  localTime: number,
) {
  const { width, height } = ctx.canvas;
  const centerX = width * 0.5;
  const brand = project.endCard.companyName || project.brand.brandName;
  const headline = scene.headline || project.script.endCardText || "Shop the Drop";
  const cta = project.script.cta || "Shop Now";
  const compact = format !== "16:9";
  const logoMaxW = compact ? width * 0.52 : width * 0.32;
  const logoMaxH = compact ? height * 0.11 : height * 0.13;

  ctx.save();
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, width, height);
  const endGradient = ctx.createLinearGradient(0, 0, width, height);
  endGradient.addColorStop(0, "rgba(255,255,255,.13)");
  endGradient.addColorStop(0.52, "rgba(0,0,0,.2)");
  endGradient.addColorStop(1, "rgba(0,0,0,.58)");
  ctx.fillStyle = endGradient;
  ctx.fillRect(0, 0, width, height);

  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0,0,0,.45)";
  ctx.shadowBlur = 28;
  drawAnimatedTextBlock(
    ctx,
    () => {
      if (logo) {
        const ratio = Math.min(logoMaxW / logo.width, logoMaxH / logo.height);
        const logoW = logo.width * ratio;
        const logoH = logo.height * ratio;
        ctx.drawImage(logo, centerX - logoW / 2, height * (compact ? 0.23 : 0.2), logoW, logoH);
      } else {
        ctx.fillStyle = "#fff";
        ctx.font = `400 ${Math.round(compact ? width * 0.105 : width * 0.052)}px "Inter Tight", Inter, sans-serif`;
        drawWrappedText(
          ctx,
          brand,
          centerX,
          height * (compact ? 0.27 : 0.24),
          width * 0.82,
          compact ? width * 0.1 : width * 0.05,
          2,
        );
      }
    },
    localTime,
    0.12,
    22,
  );

  const headlineSize = compact ? width * 0.105 : width * 0.06;
  const headlineY = height * (compact ? 0.44 : 0.42);
  drawAnimatedTextBlock(
    ctx,
    () => {
      ctx.fillStyle = "#fff";
      ctx.font = `400 ${headlineSize}px "Inter Tight", Inter, sans-serif`;
      drawWrappedText(ctx, headline, centerX, headlineY, width * 0.82, headlineSize * 0.92, 2);
    },
    localTime,
    0.44,
    28,
  );

  const buttonW = compact ? width * 0.58 : width * 0.24;
  const buttonH = compact ? height * 0.07 : height * 0.095;
  const buttonX = centerX - buttonW / 2;
  const buttonY = height * (compact ? 0.59 : 0.58);
  drawAnimatedTextBlock(
    ctx,
    () => {
      ctx.shadowBlur = 20;
      ctx.fillStyle = "#fff";
      roundRect(ctx, buttonX, buttonY, buttonW, buttonH, buttonH * 0.5);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#050505";
      ctx.font = `800 ${Math.round(buttonH * 0.32)}px Inter, sans-serif`;
      ctx.fillText(`${cta} ->`, centerX, buttonY + buttonH * 0.62);
    },
    localTime,
    0.82,
    20,
  );

  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.font = `700 ${Math.round(compact ? width * 0.032 : width * 0.017)}px Inter, sans-serif`;
  ctx.fillText(
    formatUrl(project.endCard.websiteUrl || project.brand.websiteUrl),
    centerX,
    buttonY + buttonH * 1.55,
  );
  const instagram =
    project.endCard.socialHandles?.instagram ??
    project.brand.socialHandles?.instagram ??
    `@${project.brand.brandName.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const tiktok =
    project.endCard.socialHandles?.tiktok ?? project.brand.socialHandles?.tiktok ?? instagram;
  ctx.font = `700 ${Math.round(compact ? width * 0.028 : width * 0.014)}px Inter, sans-serif`;
  ctx.fillText(`IG ${instagram}     TT ${tiktok}`, centerX, buttonY + buttonH * 2.05);

  if (qr) {
    const qrSize = compact ? width * 0.19 : width * 0.095;
    const qrX = compact ? width - qrSize - width * 0.06 : width - qrSize - width * 0.04;
    const qrY = compact ? height - qrSize - height * 0.045 : height - qrSize - height * 0.07;
    ctx.fillStyle = "rgba(255,255,255,.96)";
    roundRect(ctx, qrX - qrSize * 0.08, qrY - qrSize * 0.08, qrSize * 1.16, qrSize * 1.16, 12);
    ctx.fill();
    ctx.drawImage(qr, qrX, qrY, qrSize, qrSize);
  }
  ctx.restore();
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawAnimatedTextBlock(
  ctx: CanvasRenderingContext2D,
  draw: () => void,
  localTime: number,
  delay: number,
  xOffset = 0,
) {
  const reveal = exportReveal(localTime, delay, 0.68);
  if (reveal.alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= reveal.alpha;
  ctx.translate(xOffset * (1 - reveal.alpha), reveal.y);
  draw();
  ctx.restore();
}

function exportReveal(localTime: number, delay: number, duration: number) {
  const progress = Math.min(1, Math.max(0, (localTime - delay) / duration));
  const eased = easeOutCubic(progress);
  return {
    alpha: eased,
    y: (1 - eased) * 40,
  };
}

function drawExportBackgroundLayer(
  ctx: CanvasRenderingContext2D,
  project: AdProject,
  scene: Scene,
  image: HTMLImageElement | null,
  format: AdFormat,
  localTime: number,
  accent: string,
  showEndCard: boolean,
) {
  const { width, height } = ctx.canvas;
  if (image && !showEndCard) {
    drawCover(
      ctx,
      image,
      width,
      height,
      1 + localTime * 0.03,
      scene.formatLayouts?.[format]?.imageX ?? 50,
    );
  } else if (!showEndCard) {
    drawFallbackPoster(ctx, project, scene, width, height, accent);
  }
}

function drawExportTransitionLayer(
  ctx: CanvasRenderingContext2D,
  project: AdProject,
  currentScene: Scene,
  nextScene: Scene,
  nextImage: HTMLImageElement | null,
  format: AdFormat,
  progress: number,
  accent: string,
) {
  const { width, height } = ctx.canvas;
  const eased = easeOutCubic(progress);
  const preset = currentScene.transitionPreset ?? currentScene.transitionType ?? "luxury-fade";
  const nextIsEndCard = nextScene.role === "endcard" && project.endCard.enabled !== false;
  ctx.save();

  if (preset === "hard-flash") {
    ctx.globalAlpha = progress < 0.38 ? progress * 2.2 : Math.max(0, (1 - progress) * 0.75);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = Math.max(0, (progress - 0.18) / 0.82);
  } else if (preset === "glitch-drop") {
    ctx.globalAlpha = eased;
    for (let i = 0; i < 5; i += 1) {
      const y = (height / 5) * i;
      const jitter = Math.sin(progress * 34 + i) * width * 0.018;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y, width, height / 5 + 2);
      ctx.clip();
      ctx.translate(jitter, 0);
      drawExportBackgroundLayer(
        ctx,
        project,
        nextScene,
        nextImage,
        format,
        progress * 5,
        accent,
        nextIsEndCard,
      );
      ctx.restore();
    }
    ctx.globalAlpha = 0.12 + progress * 0.18;
    ctx.fillStyle = accent;
    ctx.fillRect(width * 0.02, 0, width * 0.015, height);
    ctx.restore();
    return;
  } else if (preset === "street-cut") {
    ctx.globalAlpha = eased;
    ctx.translate((1 - eased) * width * 0.035, 0);
  } else {
    ctx.globalAlpha = eased;
  }

  drawExportBackgroundLayer(
    ctx,
    project,
    nextScene,
    nextImage,
    format,
    progress * 5,
    accent,
    nextIsEndCard,
  );
  ctx.restore();
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, value)), 3);
}

function drawFallbackPoster(
  ctx: CanvasRenderingContext2D,
  project: AdProject,
  scene: Scene,
  width: number,
  height: number,
  accent: string,
) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#151515");
  gradient.addColorStop(0.5, "#0b0b0d");
  gradient.addColorStop(1, "#000");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = 0.32;
  ctx.fillStyle = accent;
  ctx.fillRect(width * 0.58, 0, width * 0.42, height);
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(255,255,255,.95)";
  ctx.shadowColor = "rgba(0,0,0,.55)";
  ctx.shadowBlur = 24;
  ctx.font = `700 ${Math.round(width * 0.036)}px "Inter Tight", Inter, sans-serif`;
  ctx.fillText(project.brand.brandName, width * 0.06, height * 0.14);
  ctx.font = `400 ${Math.round(width * 0.046)}px "Inter Tight", Inter, sans-serif`;
  drawWrappedText(
    ctx,
    scene.headline || project.script.headline || "Shop the drop",
    width * 0.06,
    height * 0.72,
    width * 0.52,
    width * 0.05,
    2,
  );
  ctx.font = `300 ${Math.round(width * 0.02)}px Inter, sans-serif`;
  drawWrappedText(
    ctx,
    scene.subtitle || project.brand.metaDescription || project.brand.websiteUrl,
    width * 0.06,
    height * 0.82,
    width * 0.44,
    width * 0.026,
    3,
  );
  ctx.shadowBlur = 0;
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  scale: number,
  focalX = 50,
) {
  const ratio = Math.max(width / image.width, height / image.height) * scale;
  const drawWidth = image.width * ratio;
  const drawHeight = image.height * ratio;
  const x = (width - drawWidth) * (focalX / 100);
  ctx.drawImage(image, x, (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawExportCta(
  ctx: CanvasRenderingContext2D,
  project: AdProject,
  qr: HTMLImageElement | null,
  format: AdFormat,
  localTime = 0,
) {
  const { width, height } = ctx.canvas;
  const reveal = exportReveal(localTime, 0.9, 0.6);
  if (reveal.alpha <= 0) return;
  const compact = format !== "16:9";
  const boxWidth = compact ? width * 0.78 : width * 0.32;
  const boxHeight = compact ? height * 0.08 : height * 0.12;
  const x = compact ? width * 0.08 : width * 0.035;
  const y = compact ? height * 0.86 : height * 0.78;
  ctx.save();
  ctx.globalAlpha = reveal.alpha;
  ctx.translate(0, reveal.y * 0.5);
  ctx.fillStyle = "rgba(20,20,20,.5)";
  roundRect(ctx, x, y, boxWidth, boxHeight, 14);
  ctx.fill();
  if (qr)
    ctx.drawImage(
      qr,
      x + boxHeight * 0.16,
      y + boxHeight * 0.16,
      boxHeight * 0.68,
      boxHeight * 0.68,
    );
  ctx.fillStyle = "#fff";
  ctx.font = `800 ${Math.round(boxHeight * 0.18)}px Inter, sans-serif`;
  ctx.fillText("VISIT NOW", x + boxHeight * 0.98, y + boxHeight * 0.42);
  ctx.font = `700 ${Math.round(boxHeight * 0.16)}px Inter, sans-serif`;
  ctx.fillText(
    `${project.brand.brandName} - ${formatUrl(project.qrDestinationUrl ?? project.brand.websiteUrl)}`,
    x + boxHeight * 0.98,
    y + boxHeight * 0.65,
  );
  ctx.restore();
}

function clampVolume(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.split(/\s+/);
  let line = "";
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + lines * lineHeight);
      line = word;
      lines += 1;
      if (lines >= maxLines) return;
    } else {
      line = test;
    }
  }
  if (line && lines < maxLines) ctx.fillText(line, x, y + lines * lineHeight);
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.length > lines.join(" ").split(/\s+/).length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s+$/, "")}...`;
  }
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function formatUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
