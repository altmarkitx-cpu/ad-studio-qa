import { useEditor } from "@/store/editor-store";
import {
  MUSIC_GENRES,
  VOICE_PROFILES,
  SHOT_TYPES,
  SHOT_COLORS,
  TRANSITION_LABELS,
  type BrandImageAsset,
  type Scene,
  type TextAnchor,
  type ShotType,
  type TransitionType,
} from "@/lib/types";
import { AlertTriangle, ImagePlus, Images, Trash2, Upload, Wand2 } from "lucide-react";
import { useRef, useState } from "react";

const TRANSITIONS: TransitionType[] = [
  "cut",
  "fade",
  "slide",
  "zoom",
  "street-cut",
  "luxury-fade",
  "glitch-drop",
  "hard-flash",
];
const TEXT_ANCHORS: TextAnchor[] = ["top-left", "center", "bottom-left", "bottom-center"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="p-4 border-b border-border space-y-3">
      <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] text-white/40 uppercase tracking-tighter block">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full bg-black/40 border border-white/5 rounded-md px-2.5 py-2 text-xs text-foreground outline-none focus:border-accent/40 transition-colors";

type SceneLayout = NonNullable<NonNullable<Scene["formatLayouts"]>["16:9"]>;

function sceneLayoutValue<K extends keyof SceneLayout>(
  scene: Scene,
  key: K,
  fallback: NonNullable<SceneLayout[K]>,
) {
  return (scene.formatLayouts?.["16:9"]?.[key] ?? fallback) as NonNullable<SceneLayout[K]>;
}

function updateSceneLayout(
  sceneId: string,
  patchScenes: ReturnType<typeof useEditor.getState>["patchScenes"],
  patch: Partial<SceneLayout>,
) {
  patchScenes((scenes) =>
    scenes.map((scene) =>
      scene.id === sceneId
        ? {
            ...scene,
            formatLayouts: {
              ...scene.formatLayouts,
              "16:9": {
                ...scene.formatLayouts?.["16:9"],
                ...patch,
              },
            },
          }
        : scene,
    ),
  );
}

export function Inspector() {
  const section = useEditor((s) => s.section);
  const project = useEditor((s) => s.project)!;
  const patch = useEditor((s) => s.patch);
  const patchScenes = useEditor((s) => s.patchScenes);
  const activeId = useEditor((s) => s.activeSceneId);
  const fileRef = useRef<HTMLInputElement>(null);

  if (section === "slideshow") {
    const activeIdx = project.scenes.findIndex((s) => s.id === activeId);
    const active = project.scenes[activeIdx];

    const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !active) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        patchScenes((scenes) =>
          scenes.map((s) => (s.id === active.id ? { ...s, imageUrl: dataUrl } : s)),
        );
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    };

    return (
      <>
        <Section title="Slideshow">
          <p className="text-xs text-muted-foreground">
            {project.scenes.length} scenes · total {project.durationSec}s
          </p>
        </Section>
        <WebsiteImageTray />
        {active && (
          <Section title={`Scene ${activeIdx + 1}`}>
            <Field label="Image URL">
              <input
                className={inputCls}
                value={active.imageUrl}
                onChange={(e) =>
                  patchScenes((scenes) =>
                    scenes.map((s) =>
                      s.id === active.id ? { ...s, imageUrl: e.target.value } : s,
                    ),
                  )
                }
              />
            </Field>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPickFile}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full text-xs flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
              >
                <Upload className="size-3" /> Upload image
              </button>
            </div>
            <Field label={`Duration: ${(active.endSec - active.startSec).toFixed(1)}s`}>
              <input
                type="range"
                min={1}
                max={10}
                step={0.5}
                value={active.endSec - active.startSec}
                onChange={(e) => {
                  const dur = parseFloat(e.target.value);
                  patchScenes((scenes) => {
                    let t = 0;
                    const out = scenes.map((s, i) => {
                      const d = i === activeIdx ? dur : s.endSec - s.startSec;
                      const out = { ...s, startSec: +t.toFixed(2), endSec: +(t + d).toFixed(2) };
                      t += d;
                      return out;
                    });
                    return out;
                  });
                  // Update total duration on the project as well.
                  patch((p) => {
                    const total = p.scenes.reduce(
                      (acc, s) => acc + (s.endSec - s.startSec),
                      0,
                    );
                    return { ...p, durationSec: Math.round(total) };
                  });
                }}
                className="w-full accent-accent"
              />
            </Field>
            <Field label="Headline">
              <input
                className={inputCls}
                value={active.headline ?? project.script.headline}
                onChange={(e) =>
                  patchScenes((scenes) =>
                    scenes.map((s) => (s.id === active.id ? { ...s, headline: e.target.value } : s)),
                  )
                }
              />
            </Field>
            <Field label="Subtitle">
              <textarea
                className={`${inputCls} min-h-20 resize-none leading-relaxed`}
                value={active.subtitle ?? active.caption ?? ""}
                onChange={(e) =>
                  patchScenes((scenes) =>
                    scenes.map((s) =>
                      s.id === active.id
                        ? { ...s, subtitle: e.target.value, caption: undefined }
                        : s,
                    ),
                  )
                }
              />
            </Field>
            <Field label="Bullets - one per line">
              <textarea
                className={`${inputCls} min-h-20 resize-none leading-relaxed`}
                value={(active.bullets ?? []).join("\n")}
                onChange={(e) =>
                  patchScenes((scenes) =>
                    scenes.map((s) =>
                      s.id === active.id
                        ? {
                            ...s,
                            bullets: e.target.value
                              .split("\n")
                              .map((line) => line.trim())
                              .filter(Boolean),
                          }
                        : s,
                    ),
                  )
                }
              />
            </Field>
            <Field label={`Headline size: ${sceneLayoutValue(active, "textSize", 48)}px`}>
              <input
                type="range"
                min={18}
                max={86}
                step={1}
                value={sceneLayoutValue(active, "textSize", 48)}
                onChange={(e) => updateSceneLayout(active.id, patchScenes, { textSize: Number(e.target.value) })}
                className="w-full accent-accent"
              />
            </Field>
            <Field label={`Subtitle size: ${sceneLayoutValue(active, "subtitleSize", 18)}px`}>
              <input
                type="range"
                min={10}
                max={40}
                step={1}
                value={sceneLayoutValue(active, "subtitleSize", 18)}
                onChange={(e) =>
                  updateSceneLayout(active.id, patchScenes, { subtitleSize: Number(e.target.value) })
                }
                className="w-full accent-accent"
              />
            </Field>
            <Field label="Text position">
              <select
                className={inputCls}
                value={sceneLayoutValue(active, "textAnchor", "top-left")}
                onChange={(e) =>
                  updateSceneLayout(active.id, patchScenes, { textAnchor: e.target.value as TextAnchor })
                }
              >
                {TEXT_ANCHORS.map((anchor) => (
                  <option key={anchor} value={anchor}>
                    {anchor}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Text align">
              <select
                className={inputCls}
                value={sceneLayoutValue(active, "textAlign", "left")}
                onChange={(e) =>
                  updateSceneLayout(active.id, patchScenes, {
                    textAlign: e.target.value as "left" | "center" | "right",
                  })
                }
              >
                <option value="left">left</option>
                <option value="center">center</option>
                <option value="right">right</option>
              </select>
            </Field>
            <Field label="Text color">
              <input
                type="color"
                className="h-9 w-full cursor-pointer rounded-md border border-white/5 bg-black/40"
                value={sceneLayoutValue(active, "textColor", "#ffffff")}
                onChange={(e) => updateSceneLayout(active.id, patchScenes, { textColor: e.target.value })}
              />
            </Field>
            <Field label="Image fit">
              <div className="grid grid-cols-2 gap-1">
                {(["cover", "contain"] as const).map((fit) => {
                  const selected = sceneLayoutValue(active, "imageFit", "cover") === fit;
                  return (
                    <button
                      key={fit}
                      onClick={() => updateSceneLayout(active.id, patchScenes, { imageFit: fit })}
                      className={`rounded-md px-3 py-2 text-[10px] font-bold uppercase transition-colors ${
                        selected ? "bg-accent text-white" : "bg-black/40 text-white/45 hover:bg-white/10"
                      }`}
                    >
                      {fit}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label={`Image zoom: ${Math.round(sceneLayoutValue(active, "imageScale", 1) * 100)}%`}>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.01}
                value={sceneLayoutValue(active, "imageScale", 1)}
                onChange={(e) =>
                  updateSceneLayout(active.id, patchScenes, { imageScale: Number(e.target.value) })
                }
                className="w-full accent-accent"
              />
            </Field>
            <Field label={`Image opacity: ${Math.round(sceneLayoutValue(active, "imageOpacity", 1) * 100)}%`}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={sceneLayoutValue(active, "imageOpacity", 1)}
                onChange={(e) =>
                  updateSceneLayout(active.id, patchScenes, { imageOpacity: Number(e.target.value) })
                }
                className="w-full accent-accent"
              />
            </Field>
            <Field label={`Dark overlay: ${Math.round(sceneLayoutValue(active, "overlayOpacity", 0.55) * 100)}%`}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={sceneLayoutValue(active, "overlayOpacity", 0.55)}
                onChange={(e) =>
                  updateSceneLayout(active.id, patchScenes, { overlayOpacity: Number(e.target.value) })
                }
                className="w-full accent-accent"
              />
            </Field>
            <Field label="Shot type">
              <div className="grid grid-cols-5 gap-1">
                {SHOT_TYPES.map((st) => {
                  const isActive = (active.shotType ?? "lifestyle") === st;
                  return (
                    <button
                      key={st}
                      onClick={() =>
                        patchScenes((scenes) =>
                          scenes.map((s) =>
                            s.id === active.id ? { ...s, shotType: st as ShotType } : s,
                          ),
                        )
                      }
                      className={`px-1 py-1.5 rounded text-[9px] font-bold uppercase tracking-tight transition-all ${
                        isActive ? "text-white" : "text-white/40 hover:text-white/70"
                      }`}
                      style={{
                        background: isActive ? SHOT_COLORS[st] : "rgba(255,255,255,0.04)",
                      }}
                    >
                      {st}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Transition">
              <select
                className={inputCls}
                value={active.transitionType ?? "fade"}
                onChange={(e) =>
                  patchScenes((scenes) =>
                    scenes.map((s) =>
                      s.id === active.id
                        ? { ...s, transitionType: e.target.value as TransitionType }
                        : s,
                    ),
                  )
                }
              >
                {TRANSITIONS.map((t) => (
                  <option key={t} value={t}>
                    {TRANSITION_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <button
              onClick={() =>
                patchScenes((scenes) => scenes.filter((s) => s.id !== active.id))
              }
              className="text-xs text-destructive flex items-center gap-1.5 hover:opacity-80"
            >
              <Trash2 className="size-3" /> Remove scene
            </button>
          </Section>
        )}
      </>
    );
  }


  if (section === "banner") {
    return (
      <Section title="Bottom Banner">
        <Field label="Brand name">
          <input
            className={inputCls}
            value={project.brand.brandName}
            onChange={(e) =>
              patch((p) => ({ ...p, brand: { ...p.brand, brandName: e.target.value } }))
            }
          />
        </Field>
        <Field label="Banner text">
          <input
            className={inputCls}
            value={project.script.bottomBannerText}
            onChange={(e) =>
              patch((p) => ({ ...p, script: { ...p.script, bottomBannerText: e.target.value } }))
            }
          />
        </Field>
        <Field label="Website">
          <input
            className={inputCls}
            value={project.brand.websiteUrl}
            onChange={(e) =>
              patch((p) => ({ ...p, brand: { ...p.brand, websiteUrl: e.target.value } }))
            }
          />
        </Field>
        <Field label="Phone">
          <input
            className={inputCls}
            placeholder="Optional"
            value={project.brand.contactPhone ?? ""}
            onChange={(e) =>
              patch((p) => ({ ...p, brand: { ...p.brand, contactPhone: e.target.value } }))
            }
          />
          {!project.brand.contactPhone && <MissingWarn label="No phone extracted" />}
        </Field>
      </Section>
    );
  }

  if (section === "endcard") {
    return (
      <Section title="End Screen">
        <Field label="Company name">
          <input
            className={inputCls}
            value={project.endCard.companyName}
            onChange={(e) =>
              patch((p) => ({ ...p, endCard: { ...p.endCard, companyName: e.target.value } }))
            }
          />
        </Field>
        <Field label="Website">
          <input
            className={inputCls}
            value={project.endCard.websiteUrl}
            onChange={(e) =>
              patch((p) => ({ ...p, endCard: { ...p.endCard, websiteUrl: e.target.value } }))
            }
          />
        </Field>
        <Field label="Phone">
          <input
            className={inputCls}
            value={project.endCard.phone ?? ""}
            onChange={(e) =>
              patch((p) => ({ ...p, endCard: { ...p.endCard, phone: e.target.value } }))
            }
          />
        </Field>
        <Field label="Address">
          <input
            className={inputCls}
            value={project.endCard.address ?? ""}
            onChange={(e) =>
              patch((p) => ({ ...p, endCard: { ...p.endCard, address: e.target.value } }))
            }
          />
          {!project.endCard.address && <MissingWarn label="No address extracted" />}
        </Field>
        <Field label="Accent color">
          <input
            type="color"
            className="w-full h-9 rounded-md bg-black/40 border border-white/5 cursor-pointer"
            value={project.endCard.accentColor ?? "#6366f1"}
            onChange={(e) =>
              patch((p) => ({ ...p, endCard: { ...p.endCard, accentColor: e.target.value } }))
            }
          />
        </Field>
      </Section>
    );
  }

  if (section === "qr") {
    return (
      <Section title="QR Code">
        <div className="flex items-center gap-3">
          {project.qrCodeDataUrl && (
            <img src={project.qrCodeDataUrl} alt="QR" className="size-24 rounded bg-white p-1" />
          )}
          <div className="text-xs text-muted-foreground">
            QR points to:
            <br />
            <span className="font-mono text-foreground break-all">{project.brand.websiteUrl}</span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Edit website URL in the Bottom Banner section. QR refreshes on regenerate.
        </p>
      </Section>
    );
  }

  if (section === "music") {
    return (
      <Section title="Music">
        <Field label="Genre">
          <div className="grid grid-cols-2 gap-1.5">
            {MUSIC_GENRES.map((g) => {
              const active = (project.musicGenre ?? "") === g;
              return (
                <button
                  key={g}
                  onClick={() => patch((p) => ({ ...p, musicGenre: g }))}
                  className={`px-3 py-2 rounded-md text-xs text-left transition-colors ${
                    active
                      ? "bg-accent/15 border border-accent/30 text-accent"
                      : "bg-black/40 border border-white/5 hover:border-white/15"
                  }`}
                >
                  {g}
                </button>
              );
            })}
          </div>
        </Field>
        <p className="text-[10px] text-muted-foreground">
          Recommended by AI: <span className="text-accent">{project.script.musicStyle}</span>
        </p>
      </Section>
    );
  }

  if (section === "voice") {
    return (
      <Section title="Voice & Script">
        <RewriteButton />
        <Field label="Voice profile">
          <select
            className={inputCls}
            value={project.script.voiceProfile}
            onChange={(e) =>
              patch((p) => ({ ...p, script: { ...p.script, voiceProfile: e.target.value } }))
            }
          >
            {VOICE_PROFILES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
            {!VOICE_PROFILES.includes(project.script.voiceProfile as any) && (
              <option value={project.script.voiceProfile}>{project.script.voiceProfile}</option>
            )}
          </select>
        </Field>
        <Field label="Voiceover script">
          <textarea
            className={`${inputCls} min-h-[140px] leading-relaxed resize-none`}
            value={project.script.voiceoverScript}
            onChange={(e) =>
              patch((p) => ({ ...p, script: { ...p.script, voiceoverScript: e.target.value } }))
            }
          />
        </Field>
        <Field label="Headline">
          <input
            className={inputCls}
            value={project.script.headline}
            onChange={(e) =>
              patch((p) => ({ ...p, script: { ...p.script, headline: e.target.value } }))
            }
          />
        </Field>
        <Field label="CTA">
          <input
            className={inputCls}
            value={project.script.cta}
            onChange={(e) =>
              patch((p) => ({ ...p, script: { ...p.script, cta: e.target.value } }))
            }
          />
        </Field>
      </Section>
    );
  }

  // AI Input Settings
  return (
    <Section title="AI Input Settings">
      <Field label="Source type">
        <div className="space-y-1.5">
          <div className="px-3 py-2 rounded-md bg-accent/15 border border-accent/30 text-accent text-xs">
            Website URL
          </div>
          <div className="px-3 py-2 rounded-md bg-black/40 border border-white/5 text-muted-foreground text-xs opacity-60">
            Google Business · coming soon
          </div>
        </div>
      </Field>
      <Field label="Source URL">
        <input className={inputCls} value={project.sourceUrl} readOnly />
      </Field>
      <Field label="Detected tone">
        <div className="text-xs text-muted-foreground">
          {project.script.voiceProfile} · {project.script.musicStyle}
        </div>
      </Field>
    </Section>
  );
}

function WebsiteImageTray() {
  const project = useEditor((s) => s.project)!;
  const patch = useEditor((s) => s.patch);
  const patchScenes = useEditor((s) => s.patchScenes);
  const activeId = useEditor((s) => s.activeSceneId);
  const uploadRef = useRef<HTMLInputElement>(null);
  const images = collectWebsiteImages(project);

  const addUploadedFiles = (files: FileList | File[]) => {
    Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .forEach((file) => {
        const reader = new FileReader();
        reader.onload = () => {
          patch((p) => addAssetToProject(p, String(reader.result), file.name, "upload"));
        };
        reader.readAsDataURL(file);
      });
  };

  const replaceActive = (url: string) => {
    if (!activeId) return;
    patchScenes((scenes) =>
      scenes.map((scene) => (scene.id === activeId ? { ...scene, imageUrl: url } : scene)),
    );
  };

  return (
    <Section title="Website Images">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.currentTarget.classList.add("border-accent/60");
        }}
        onDragLeave={(e) => e.currentTarget.classList.remove("border-accent/60")}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove("border-accent/60");
          addUploadedFiles(e.dataTransfer.files);
        }}
        className="rounded-lg border border-dashed border-white/10 bg-black/30 p-3 transition-colors"
      >
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            addUploadedFiles(e.target.files ?? []);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => uploadRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-white/10"
        >
          <ImagePlus className="size-3.5" />
          Upload images
        </button>
        <p className="mt-2 text-center text-[10px] leading-relaxed text-muted-foreground">
          Drop files here. Drag any thumbnail to the timeline.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <Images className="size-3" />
          {images.length} assets
        </p>
        <p className="text-[9px] text-muted-foreground/70">drop on scene = replace</p>
      </div>

      <div className="max-h-[340px] overflow-y-auto pr-1">
        <div className="grid grid-cols-3 gap-2">
          {images.map((asset, index) => (
            <button
              key={`${asset.url}-${index}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "copy";
                e.dataTransfer.setData("text/plain", asset.url);
                e.dataTransfer.setData("application/x-adstudio-image", asset.url);
              }}
              onClick={() => replaceActive(asset.url)}
              title={asset.alt || asset.source || "Website image"}
              className="group relative aspect-square overflow-hidden rounded-md border border-white/5 bg-white/[0.03] transition-all hover:border-accent/60"
            >
              <img
                src={asset.url}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                draggable={false}
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
              />
              <span className="absolute left-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[8px] font-bold uppercase text-white/85">
                {asset.kind || asset.source || "site"}
              </span>
              <span className="absolute inset-x-1 bottom-1 rounded bg-black/70 px-1 py-0.5 text-[8px] text-white/75 opacity-0 transition-opacity group-hover:opacity-100">
                Drag or click
              </span>
            </button>
          ))}
        </div>
        {images.length === 0 && (
          <div className="rounded-md border border-white/5 bg-black/30 p-3 text-xs text-muted-foreground">
            No website images were saved for this project. Upload images here or regenerate.
          </div>
        )}
      </div>
    </Section>
  );
}

function collectWebsiteImages(project: NonNullable<ReturnType<typeof useEditor.getState>["project"]>) {
  const seen = new Set<string>();
  const assets: BrandImageAsset[] = [];
  const push = (asset: BrandImageAsset) => {
    if (!asset.url || seen.has(asset.url)) return;
    seen.add(asset.url);
    assets.push(asset);
  };

  project.brand.imageAssets?.forEach((asset) => push(asset));
  project.brand.selectedImages?.forEach((url, index) =>
    push({ id: `selected-${index}`, url, source: "selected" }),
  );
  project.brand.imageCandidates?.forEach((url, index) =>
    push({ id: `candidate-${index}`, url, source: "site" }),
  );
  project.scenes.forEach((scene, index) =>
    push({
      id: scene.visualAssetId || `scene-${index}`,
      url: scene.imageUrl,
      source: "scene",
      kind: scene.shotType,
    }),
  );

  return assets;
}

function addAssetToProject(
  project: NonNullable<ReturnType<typeof useEditor.getState>["project"]>,
  url: string,
  alt: string,
  source: string,
) {
  const candidates = project.brand.imageCandidates ?? [];
  const imageAssets = project.brand.imageAssets ?? [];
  if (candidates.includes(url) || imageAssets.some((asset) => asset.url === url)) return project;

  return {
    ...project,
    brand: {
      ...project.brand,
      imageCandidates: [...candidates, url],
      imageAssets: [
        ...imageAssets,
        {
          id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          url,
          alt,
          source,
          kind: "ugc" as const,
          score: 100,
        },
      ],
    },
  };
}

function MissingWarn({ label }: { label: string }) {
  return (
    <p className="text-[10px] text-amber-400/80 flex items-center gap-1 mt-1">
      <AlertTriangle className="size-3" /> {label}
    </p>
  );
}

function RewriteButton() {
  const project = useEditor((s) => s.project)!;
  const patchScript = useEditor((s) => s.patchScript);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setErr(null);
    try {
      const mod = await import("@/lib/ad.functions");
      const next = await mod.regenerateScript({ data: { id: project.id } });
      patchScript(next as any);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to rewrite");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={run}
        disabled={loading}
        className="w-full text-xs flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-accent/15 hover:bg-accent/25 border border-accent/30 text-accent transition-colors disabled:opacity-50"
      >
        <Wand2 className="size-3" /> {loading ? "Rewriting…" : "Rewrite with AI"}
      </button>
      {err && <p className="text-[10px] text-destructive mt-1">{err}</p>}
    </div>
  );
}
