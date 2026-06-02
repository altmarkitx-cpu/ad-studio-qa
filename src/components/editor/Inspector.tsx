import { useEditor } from "@/store/editor-store";
import { useServerFn } from "@tanstack/react-start";
import {
  MUSIC_GENRES,
  VOICE_PROFILES,
  type AdCategory,
  type AdProject,
  type AdTemplate,
  type SceneRole,
  type ScriptOutput,
  type ShotType,
  type TextAnchor,
  type TransitionPreset,
  type TransitionType,
} from "@/lib/types";
import { appendImageScenes, autoAssignShots, insertImageScenesWithIds } from "@/lib/scene-utils";
import { AD_CATEGORIES, AD_TEMPLATES, MUSIC_BEDS } from "@/lib/ad-presets";
import { generateVoiceover } from "@/lib/ad.functions";
import QRCode from "qrcode";
import {
  AlertTriangle,
  Image,
  Layers3,
  Mic,
  Scissors,
  Shuffle,
  Square,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import { useRef, useState } from "react";

const TRANSITIONS: TransitionType[] = ["cut", "fade", "slide", "zoom"];
const SCENE_ROLES: SceneRole[] = ["hook", "product", "proof", "endcard"];
const SHOT_TYPES: ShotType[] = ["lifestyle", "product", "detail", "ugc", "brand"];
const TRANSITION_PRESETS: { id: TransitionPreset; label: string }[] = [
  { id: "street-cut", label: "Street Cut" },
  { id: "luxury-fade", label: "Luxury Fade" },
  { id: "glitch-drop", label: "Glitch Drop" },
  { id: "hard-flash", label: "Hard Flash" },
];
const TEXT_ANCHORS: TextAnchor[] = ["bottom-left", "bottom-center", "center", "top-left"];

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

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-md border border-white/5 bg-black/40 px-3 py-2 text-left text-xs transition-colors hover:border-white/15"
    >
      <span>{label}</span>
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-white/15"
        }`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

export function Inspector() {
  const section = useEditor((s) => s.section);
  const project = useEditor((s) => s.project)!;
  const patch = useEditor((s) => s.patch);
  const patchScenes = useEditor((s) => s.patchScenes);
  const activeId = useEditor((s) => s.activeSceneId);
  const variants = useEditor((s) => s.variants);
  const activeVariantId = useEditor((s) => s.activeVariantId);
  const selectVariant = useEditor((s) => s.selectVariant);
  const createVariant = useEditor((s) => s.createVariant);
  const removeVariant = useEditor((s) => s.removeVariant);
  const generateVoice = useServerFn(generateVoiceover);
  const fileRef = useRef<HTMLInputElement>(null);
  const musicRef = useRef<HTMLInputElement>(null);
  const voiceoverRef = useRef<HTMLInputElement>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<BlobPart[]>([]);
  const [recordingVoiceover, setRecordingVoiceover] = useState(false);
  const [generatingVoiceover, setGeneratingVoiceover] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [customVariantPrompt, setCustomVariantPrompt] = useState("");
  const [repairingImages, setRepairingImages] = useState(false);

  const updateQrDestination = async (destination: string) => {
    patch((p) => ({ ...p, qrDestinationUrl: destination }));
    try {
      const qrCodeDataUrl = await QRCode.toDataURL(destination || project.brand.websiteUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 256,
        color: { dark: "#000000", light: "#ffffff" },
      });
      patch((p) => (p.qrDestinationUrl === destination ? { ...p, qrCodeDataUrl } : p));
    } catch {
      // Keep the previous QR image if the typed destination cannot be encoded yet.
    }
  };

  if (section === "slideshow") {
    const activeIdx = project.scenes.findIndex((s) => s.id === activeId);
    const active = project.scenes[activeIdx];
    const updateActiveScene = (scenePatch: Partial<NonNullable<typeof active>>) => {
      if (!active) return;
      patchScenes((scenes) =>
        scenes.map((scene) => (scene.id === active.id ? { ...scene, ...scenePatch } : scene)),
      );
    };

    const setActiveImage = async (imageUrl: string) => {
      if (!active) return;
      const safeImageUrl = await materializeImageForVideo(imageUrl);
      patch((p) => ({
        ...p,
        scenes: p.scenes.map((s) => (s.id === active.id ? { ...s, imageUrl: safeImageUrl } : s)),
        brand: addImagesToBrandLibrary(p.brand, [safeImageUrl, imageUrl]),
      }));
    };

    const readImageFiles = async (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) return;
      const dataUrls = await Promise.all(imageFiles.map(readFileAsDataUrl));
      let firstInsertedId: string | undefined;
      patch((p) => {
        const inserted = insertImageScenesWithIds(p.scenes, dataUrls, p.scenes.length);
        firstInsertedId = inserted.insertedIds[0];
        return {
          ...p,
          scenes: inserted.scenes,
          durationSec: Math.round(
            inserted.scenes.reduce(
              (total, scene) => total + Math.max(0, scene.endSec - scene.startSec),
              0,
            ),
          ),
          brand: addImagesToBrandLibrary(p.brand, dataUrls),
        };
      });
      if (firstInsertedId) setTimeout(() => useEditor.getState().setActiveScene(firstInsertedId));
    };

    const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) void readImageFiles(e.target.files);
      e.target.value = "";
    };

    const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (e.dataTransfer.files) void readImageFiles(e.dataTransfer.files);
    };

    const candidates = prioritizeVisualImages([
      ...project.brand.imageCandidates,
      ...project.brand.selectedImages,
    ]);
    const liveSceneImageCount = project.scenes.filter((scene) =>
      /^https?:\/\//i.test(scene.imageUrl),
    ).length;

    const repairSceneImages = async () => {
      setRepairingImages(true);
      try {
        const repaired = await Promise.all(
          project.scenes.map(async (scene) => ({
            id: scene.id,
            original: scene.imageUrl,
            safe: await materializeImageForVideo(scene.imageUrl),
          })),
        );
        patch((p) => {
          const byId = new Map(repaired.map((item) => [item.id, item]));
          const imageUrls = repaired.flatMap((item) => [item.safe, item.original]);
          return {
            ...p,
            scenes: p.scenes.map((scene) => {
              const next = byId.get(scene.id);
              return next ? { ...scene, imageUrl: next.safe } : scene;
            }),
            brand: addImagesToBrandLibrary(p.brand, imageUrls),
          };
        });
      } finally {
        setRepairingImages(false);
      }
    };

    return (
      <>
        <Section title="Scenes">
          <p className="text-xs text-muted-foreground">
            {project.scenes.length} scenes · total {project.durationSec}s
          </p>
          <button
            onClick={() => void repairSceneImages()}
            disabled={repairingImages || liveSceneImageCount === 0}
            className="w-full text-xs flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-accent/15 hover:bg-accent/25 border border-accent/30 text-accent transition-colors disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Wand2 className={`size-3 ${repairingImages ? "animate-spin" : ""}`} />
            {repairingImages
              ? "Repairing scene images..."
              : liveSceneImageCount > 0
                ? `Repair ${liveSceneImageCount} live image${liveSceneImageCount === 1 ? "" : "s"}`
                : "Scene images video-safe"}
          </button>
        </Section>
        {active && (
          <Section title={`Scene ${activeIdx + 1}`}>
            <Field label="Image URL">
              <input
                className={inputCls}
                value={active.imageUrl}
                onChange={(e) => updateActiveScene({ imageUrl: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Scene role">
                <select
                  className={inputCls}
                  value={active.role ?? "product"}
                  onChange={(e) => updateActiveScene({ role: e.target.value as SceneRole })}
                >
                  {SCENE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role.toUpperCase()}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Rating">
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  max={5}
                  step={0.1}
                  value={active.rating ?? ""}
                  placeholder="Optional"
                  onChange={(e) =>
                    updateActiveScene({
                      rating: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                />
              </Field>
            </div>
            <Field label="Headline">
              <input
                className={inputCls}
                value={active.headline ?? ""}
                placeholder="Main on-screen line"
                onChange={(e) => updateActiveScene({ headline: e.target.value })}
              />
            </Field>
            <Field label="Subtitle">
              <textarea
                className={inputCls}
                rows={2}
                value={active.subtitle ?? ""}
                placeholder="Secondary on-screen line"
                onChange={(e) => updateActiveScene({ subtitle: e.target.value })}
              />
            </Field>
            <Field label="Bullets">
              <textarea
                className={inputCls}
                rows={4}
                value={(active.bullets ?? []).join("\n")}
                placeholder={"One bullet per line"}
                onChange={(e) =>
                  updateActiveScene({
                    bullets: e.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>
            <Field label="Review quote">
              <textarea
                className={inputCls}
                rows={2}
                value={active.quote ?? ""}
                placeholder="Optional proof quote"
                onChange={(e) => updateActiveScene({ quote: e.target.value })}
              />
            </Field>
            <Field label="Reviewer">
              <input
                className={inputCls}
                value={active.reviewer ?? ""}
                placeholder="@handle or name"
                onChange={(e) => updateActiveScene({ reviewer: e.target.value })}
              />
            </Field>
            <Field label="Caption / voice line">
              <textarea
                className={inputCls}
                rows={3}
                value={active.caption ?? ""}
                placeholder="Caption shown with voiceover"
                onChange={(e) => updateActiveScene({ caption: e.target.value })}
              />
            </Field>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className="rounded-lg border border-dashed border-white/10 bg-black/30 p-3"
            >
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
                className="w-full text-xs flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
              >
                <Upload className="size-3" /> Add images
              </button>
              <p className="mt-2 text-center text-[10px] text-muted-foreground">
                Drag and drop one or many images here
              </p>
            </div>
            <button
              onClick={() =>
                patchScenes((scenes) =>
                  appendImageScenes(scenes, [
                    active.imageUrl ||
                      project.brand.selectedImages[0] ||
                      project.brand.imageCandidates[0] ||
                      "",
                  ]),
                )
              }
              className="w-full text-xs flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
            >
              <Layers3 className="size-3" /> Duplicate as new scene
            </button>
            {candidates.length > 0 && (
              <Field label="Website images">
                <div className="mb-2 flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      const next = candidates[Math.floor(Math.random() * candidates.length)];
                      if (next) void setActiveImage(next);
                    }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-white/5 bg-white/5 px-3 py-2 text-xs transition-colors hover:bg-white/10"
                  >
                    <Shuffle className="size-3" /> Pick different
                  </button>
                  <span className="rounded-md border border-white/5 bg-black/35 px-2 py-2 text-[10px] font-mono text-muted-foreground">
                    {candidates.length}
                  </span>
                </div>
                <div className="grid max-h-[420px] grid-cols-3 gap-1.5 overflow-y-auto pr-1">
                  {candidates.map((url) => {
                    const selected = active.imageUrl === url;
                    return (
                      <button
                        key={url}
                        draggable
                        onDragStart={(e) => {
                          window.__creativeSparkDragImages = [url];
                          e.dataTransfer.effectAllowed = "copy";
                          e.dataTransfer.setData("text/plain", url);
                          e.dataTransfer.setData("text/uri-list", url);
                          e.dataTransfer.setData(
                            "application/x-creative-spark-image",
                            JSON.stringify({ imageUrls: [url] }),
                          );
                        }}
                        onDragEnd={() => {
                          window.__creativeSparkDragImages = undefined;
                        }}
                        onClick={() => void setActiveImage(url)}
                        className={`relative aspect-square overflow-hidden rounded-md border transition-all ${
                          selected ? "border-accent ring-2 ring-accent/30" : "border-white/5"
                        }`}
                        title="Drag to timeline or click to use"
                      >
                        <img
                          src={url}
                          alt=""
                          draggable={false}
                          className="absolute inset-0 h-full w-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                        {!selected && (
                          <span className="absolute inset-0 grid place-items-center bg-black/0 text-white/0 transition-colors hover:bg-black/35 hover:text-white">
                            <Image className="size-4" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}
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
                    const total = p.scenes.reduce((acc, s) => acc + (s.endSec - s.startSec), 0);
                    return { ...p, durationSec: Math.round(total) };
                  });
                }}
                className="w-full accent-accent"
              />
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
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Shot label">
              <select
                className={inputCls}
                value={active.shotType ?? "lifestyle"}
                onChange={(e) =>
                  patchScenes((scenes) =>
                    scenes.map((s) =>
                      s.id === active.id ? { ...s, shotType: e.target.value as ShotType } : s,
                    ),
                  )
                }
              >
                {SHOT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.toUpperCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Transition preset">
              <select
                className={inputCls}
                value={active.transitionPreset ?? "street-cut"}
                onChange={(e) =>
                  patchScenes((scenes) =>
                    scenes.map((s) =>
                      s.id === active.id
                        ? { ...s, transitionPreset: e.target.value as TransitionPreset }
                        : s,
                    ),
                  )
                }
              >
                {TRANSITION_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="16:9 text position">
              <select
                className={inputCls}
                value={active.formatLayouts?.["16:9"]?.textAnchor ?? "bottom-left"}
                onChange={(e) =>
                  patchScenes((scenes) =>
                    scenes.map((s) =>
                      s.id === active.id
                        ? {
                            ...s,
                            formatLayouts: {
                              ...s.formatLayouts,
                              "16:9": {
                                ...s.formatLayouts?.["16:9"],
                                textAnchor: e.target.value as TextAnchor,
                              },
                            },
                          }
                        : s,
                    ),
                  )
                }
              >
                {TEXT_ANCHORS.map((anchor) => (
                  <option key={anchor} value={anchor}>
                    {anchor}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="9:16 crop X">
              <input
                type="range"
                min={0}
                max={100}
                value={active.formatLayouts?.["9:16"]?.imageX ?? 50}
                onChange={(e) =>
                  patchScenes((scenes) =>
                    scenes.map((s) =>
                      s.id === active.id
                        ? {
                            ...s,
                            formatLayouts: {
                              ...s.formatLayouts,
                              "9:16": {
                                ...s.formatLayouts?.["9:16"],
                                imageX: Number(e.target.value),
                              },
                            },
                          }
                        : s,
                    ),
                  )
                }
                className="w-full accent-accent"
              />
            </Field>
            <button
              onClick={() => patchScenes(autoAssignShots)}
              className="w-full text-xs flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-accent/15 hover:bg-accent/25 border border-accent/30 text-accent transition-colors"
            >
              <Wand2 className="size-3" /> Auto-assign shots
            </button>
            <button
              onClick={() => patchScenes((scenes) => scenes.filter((s) => s.id !== active.id))}
              className="text-xs text-destructive flex items-center gap-1.5 hover:opacity-80"
            >
              <Trash2 className="size-3" /> Remove scene
            </button>
            <button
              onClick={() => {
                const duration = active.endSec - active.startSec;
                if (duration <= 2) return;
                patchScenes((scenes) => {
                  let time = 0;
                  return scenes
                    .flatMap((s) => {
                      if (s.id !== active.id) return [s];
                      const half = duration / 2;
                      return [
                        { ...s, endSec: s.startSec + half },
                        {
                          ...s,
                          id: `scene-${crypto.randomUUID()}`,
                          startSec: s.startSec + half,
                          endSec: s.endSec,
                        },
                      ];
                    })
                    .map((s) => {
                      const d = s.endSec - s.startSec;
                      const next = { ...s, startSec: time, endSec: time + d };
                      time += d;
                      return next;
                    });
                });
              }}
              className="text-xs text-muted-foreground flex items-center gap-1.5 hover:text-foreground"
            >
              <Scissors className="size-3" /> Split scene
            </button>
          </Section>
        )}
      </>
    );
  }

  if (section === "banner") {
    return (
      <Section title="Bottom Banner">
        <ToggleField
          label="Show bottom banner"
          checked={project.bottomBannerEnabled !== false}
          onChange={(checked) => patch((p) => ({ ...p, bottomBannerEnabled: checked }))}
        />
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
              patch((p) => ({
                ...p,
                brand: { ...p.brand, websiteUrl: e.target.value },
                endCard: { ...p.endCard, websiteUrl: e.target.value },
                qrDestinationUrl: p.qrDestinationUrl || e.target.value,
              }))
            }
          />
        </Field>
        <Field label="Logo URL">
          <input
            className={inputCls}
            placeholder="Optional"
            value={project.brand.logoUrl ?? ""}
            onChange={(e) =>
              patch((p) => ({
                ...p,
                brand: { ...p.brand, logoUrl: e.target.value },
                endCard: { ...p.endCard, logoUrl: e.target.value },
              }))
            }
          />
        </Field>
        <Field label="Phone">
          <input
            className={inputCls}
            placeholder="Optional"
            value={project.brand.contactPhone ?? ""}
            onChange={(e) =>
              patch((p) => ({
                ...p,
                brand: { ...p.brand, contactPhone: e.target.value },
                endCard: { ...p.endCard, phone: e.target.value },
              }))
            }
          />
          {!project.brand.contactPhone && <MissingWarn label="No phone extracted" />}
        </Field>
        <Field label="Address">
          <input
            className={inputCls}
            placeholder="Optional"
            value={project.brand.address ?? ""}
            onChange={(e) =>
              patch((p) => ({
                ...p,
                brand: { ...p.brand, address: e.target.value },
                endCard: { ...p.endCard, address: e.target.value },
              }))
            }
          />
          {!project.brand.address && <MissingWarn label="No address extracted" />}
        </Field>
      </Section>
    );
  }

  if (section === "endcard") {
    return (
      <Section title="End Screen">
        <ToggleField
          label="Show end screen"
          checked={project.endCard.enabled !== false}
          onChange={(checked) =>
            patch((p) => ({ ...p, endCard: { ...p.endCard, enabled: checked } }))
          }
        />
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
              patch((p) => ({
                ...p,
                endCard: { ...p.endCard, websiteUrl: e.target.value },
                qrDestinationUrl: p.qrDestinationUrl || e.target.value,
              }))
            }
          />
        </Field>
        <Field label="Logo URL">
          <input
            className={inputCls}
            placeholder="Optional"
            value={project.endCard.logoUrl ?? ""}
            onChange={(e) =>
              patch((p) => ({ ...p, endCard: { ...p.endCard, logoUrl: e.target.value } }))
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
        <Field label="Instagram">
          <input
            className={inputCls}
            placeholder="@handle"
            value={project.endCard.socialHandles?.instagram ?? ""}
            onChange={(e) =>
              patch((p) => ({
                ...p,
                endCard: {
                  ...p.endCard,
                  socialHandles: { ...p.endCard.socialHandles, instagram: e.target.value },
                },
                brand: {
                  ...p.brand,
                  socialHandles: { ...p.brand.socialHandles, instagram: e.target.value },
                },
              }))
            }
          />
        </Field>
        <Field label="TikTok">
          <input
            className={inputCls}
            placeholder="@handle"
            value={project.endCard.socialHandles?.tiktok ?? ""}
            onChange={(e) =>
              patch((p) => ({
                ...p,
                endCard: {
                  ...p.endCard,
                  socialHandles: { ...p.endCard.socialHandles, tiktok: e.target.value },
                },
                brand: {
                  ...p.brand,
                  socialHandles: { ...p.brand.socialHandles, tiktok: e.target.value },
                },
              }))
            }
          />
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
        <ToggleField
          label="Show QR code"
          checked={project.qrEnabled !== false}
          onChange={(checked) => patch((p) => ({ ...p, qrEnabled: checked }))}
        />
        <div className="flex items-center gap-3">
          {project.qrEnabled !== false && project.qrCodeDataUrl && (
            <img src={project.qrCodeDataUrl} alt="QR" className="size-24 rounded bg-white p-1" />
          )}
          <div className="text-xs text-muted-foreground">
            QR points to:
            <br />
            <span className="font-mono text-foreground break-all">
              {project.qrDestinationUrl ?? project.brand.websiteUrl}
            </span>
          </div>
        </div>
        <Field label="Destination URL">
          <input
            className={inputCls}
            value={project.qrDestinationUrl ?? project.brand.websiteUrl}
            onChange={(e) => void updateQrDestination(e.target.value)}
          />
        </Field>
        <button
          onClick={() => void updateQrDestination(project.brand.websiteUrl)}
          className="w-full text-xs flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
        >
          Use website URL
        </button>
      </Section>
    );
  }

  if (section === "music") {
    const onMusicPick = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 18_000_000) {
        setAudioError("Music file is too large. Use audio under 18MB.");
        e.target.value = "";
        return;
      }
      setAudioError(null);
      const reader = new FileReader();
      reader.onload = () => {
        patch((p) => ({
          ...p,
          musicAudioDataUrl: String(reader.result),
          musicAudioName: file.name,
          musicGenre: "Custom",
          musicEnabled: true,
          musicVolume: p.musicVolume ?? 0.34,
        }));
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    };
    const remoteMusicUrl =
      project.musicAudioDataUrl && /^https?:\/\//i.test(project.musicAudioDataUrl)
        ? project.musicAudioDataUrl
        : "";

    return (
      <Section title="Music">
        <ToggleField
          label="Enable music"
          checked={project.musicEnabled !== false}
          onChange={(checked) => patch((p) => ({ ...p, musicEnabled: checked }))}
        />
        <Field label={`Volume: ${Math.round((project.musicVolume ?? 0.34) * 100)}%`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={project.musicVolume ?? 0.34}
            onChange={(e) => patch((p) => ({ ...p, musicVolume: Number(e.target.value) }))}
            className="w-full accent-accent"
          />
        </Field>
        <input
          ref={musicRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={onMusicPick}
        />
        <button
          onClick={() => musicRef.current?.click()}
          className="w-full text-xs flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
        >
          <Upload className="size-3" /> Upload music bed
        </button>
        <Field label="Real music URL">
          <input
            className={inputCls}
            placeholder="https://cdn.example.com/track.mp3"
            value={remoteMusicUrl}
            onChange={(e) => {
              const value = e.target.value.trim();
              setAudioError(null);
              patch((p) => ({
                ...p,
                musicAudioDataUrl: value || undefined,
                musicAudioName: value ? "Remote music bed" : undefined,
                musicGenre: value ? "Custom" : p.musicGenre,
                musicEnabled: value ? true : p.musicEnabled,
                musicVolume: p.musicVolume ?? 0.34,
              }));
            }}
          />
        </Field>
        {project.musicAudioName && (
          <p className="text-[10px] text-muted-foreground">
            Using real music bed: <span className="text-foreground">{project.musicAudioName}</span>
          </p>
        )}
        {!project.musicAudioName && (
          <p className="text-[10px] text-muted-foreground">
            Presets export as generated beds. Upload audio or paste a licensed MP3/WAV URL for a
            real music file.
          </p>
        )}
        {audioError && <p className="text-[10px] text-destructive">{audioError}</p>}
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
        <Field label="Music beds">
          <div className="grid grid-cols-1 gap-1.5">
            {MUSIC_BEDS.map((bed) => {
              const active = project.musicBedId === bed.id;
              return (
                <button
                  key={bed.id}
                  onClick={() => {
                    setAudioError(null);
                    patch((p) => ({
                      ...p,
                      musicBedId: bed.id,
                      musicGenre: bed.genre,
                      musicEnabled: true,
                      musicVolume: p.musicVolume ?? 0.34,
                      musicAudioDataUrl: undefined,
                      musicAudioName: undefined,
                    }));
                  }}
                  className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    active
                      ? "border-accent/40 bg-accent/15 text-accent"
                      : "border-white/5 bg-black/40 hover:border-white/15"
                  }`}
                >
                  <span className="font-bold">{bed.label}</span>
                  <span className="ml-2 text-[10px] text-muted-foreground">{bed.bpm} BPM</span>
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
    const onVoiceoverPick = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 18_000_000) {
        setAudioError("Voiceover file is too large. Use audio under 18MB.");
        e.target.value = "";
        return;
      }
      setAudioError(null);
      const reader = new FileReader();
      reader.onload = () => {
        patch((p) => ({
          ...p,
          voiceoverAudioDataUrl: String(reader.result),
          voiceoverAudioName: file.name,
          voiceoverEnabled: true,
          voiceoverVolume: p.voiceoverVolume ?? 0.9,
        }));
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    };

    const startVoiceRecording = async () => {
      setAudioError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setAudioError("Microphone recording is not available in this browser.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        voiceChunksRef.current = [];
        voiceRecorderRef.current = recorder;
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) voiceChunksRef.current.push(event.data);
        };
        recorder.onstop = () => {
          const blob = new Blob(voiceChunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          stream.getTracks().forEach((track) => track.stop());
          const reader = new FileReader();
          reader.onload = () => {
            patch((p) => ({
              ...p,
              voiceoverAudioDataUrl: String(reader.result),
              voiceoverAudioName: `Recorded voiceover ${new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}`,
              voiceoverEnabled: true,
              voiceoverVolume: p.voiceoverVolume ?? 0.9,
            }));
          };
          reader.readAsDataURL(blob);
          voiceRecorderRef.current = null;
          setRecordingVoiceover(false);
        };
        recorder.start();
        setRecordingVoiceover(true);
      } catch (error) {
        setAudioError(error instanceof Error ? error.message : "Could not start recording.");
        setRecordingVoiceover(false);
      }
    };

    const stopVoiceRecording = () => {
      if (voiceRecorderRef.current?.state === "recording") {
        voiceRecorderRef.current.stop();
      }
    };

    const generateExportVoiceover = async () => {
      const script = project.script.voiceoverScript.trim();
      if (!script) {
        setAudioError("Write a voiceover script before generating audio.");
        return;
      }
      setAudioError(null);
      setGeneratingVoiceover(true);
      try {
        const result = await generateVoice({
          data: { script, profile: project.script.voiceProfile },
        });
        patch((p) => ({
          ...p,
          voiceoverAudioDataUrl: result.audioDataUrl,
          voiceoverAudioName: `${result.voiceName} - ${new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}`,
          voiceoverEnabled: true,
          voiceoverVolume: p.voiceoverVolume ?? 0.9,
        }));
      } catch (error) {
        setAudioError(error instanceof Error ? error.message : "Could not generate voiceover.");
      } finally {
        setGeneratingVoiceover(false);
      }
    };

    return (
      <Section title="Voice & Script">
        <RewriteButton />
        <ToggleField
          label="Enable voiceover"
          checked={project.voiceoverEnabled !== false}
          onChange={(checked) => patch((p) => ({ ...p, voiceoverEnabled: checked }))}
        />
        <Field label={`Volume: ${Math.round((project.voiceoverVolume ?? 0.9) * 100)}%`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={project.voiceoverVolume ?? 0.9}
            onChange={(e) => patch((p) => ({ ...p, voiceoverVolume: Number(e.target.value) }))}
            className="w-full accent-accent"
          />
        </Field>
        <Field label="Quick voice">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() =>
                patch((p) => ({
                  ...p,
                  script: { ...p.script, voiceProfile: "Cinematic & deep" },
                  voiceoverEnabled: true,
                }))
              }
              className={`rounded-md border px-3 py-2 text-xs transition-colors ${
                project.script.voiceProfile === "Cinematic & deep"
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-white/5 bg-black/40 hover:border-white/15"
              }`}
            >
              Male
            </button>
            <button
              onClick={() =>
                patch((p) => ({
                  ...p,
                  script: { ...p.script, voiceProfile: "Warm & inviting" },
                  voiceoverEnabled: true,
                }))
              }
              className={`rounded-md border px-3 py-2 text-xs transition-colors ${
                project.script.voiceProfile === "Warm & inviting"
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-white/5 bg-black/40 hover:border-white/15"
              }`}
            >
              Female
            </button>
          </div>
        </Field>
        <input
          ref={voiceoverRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={onVoiceoverPick}
        />
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => voiceoverRef.current?.click()}
            className="text-xs flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
          >
            <Upload className="size-3" /> Upload voiceover
          </button>
          <button
            onClick={recordingVoiceover ? stopVoiceRecording : startVoiceRecording}
            className={`text-xs flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border transition-colors ${
              recordingVoiceover
                ? "border-destructive/40 bg-destructive/15 text-destructive"
                : "border-white/5 bg-white/5 hover:bg-white/10"
            }`}
          >
            {recordingVoiceover ? (
              <>
                <Square className="size-3 fill-current" /> Stop
              </>
            ) : (
              <>
                <Mic className="size-3" /> Record
              </>
            )}
          </button>
        </div>
        <button
          onClick={() => void generateExportVoiceover()}
          disabled={generatingVoiceover || !project.script.voiceoverScript.trim()}
          className="w-full text-xs flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-accent/15 hover:bg-accent/25 border border-accent/30 text-accent transition-colors disabled:opacity-40"
        >
          <Wand2 className="size-3" />{" "}
          {generatingVoiceover ? "Generating export voice..." : "Generate export voiceover"}
        </button>
        {project.voiceoverAudioName && (
          <p className="text-[10px] text-muted-foreground">
            Export voiceover: <span className="text-foreground">{project.voiceoverAudioName}</span>
          </p>
        )}
        {!project.voiceoverAudioName && (
          <p className="text-[10px] text-muted-foreground">
            Preview voice uses browser TTS. Record or upload for exported voiceover.
          </p>
        )}
        {audioError && <p className="text-[10px] text-destructive">{audioError}</p>}
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
            {!VOICE_PROFILES.some((voice) => voice === project.script.voiceProfile) && (
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
            onChange={(e) => patch((p) => ({ ...p, script: { ...p.script, cta: e.target.value } }))}
          />
        </Field>
      </Section>
    );
  }

  // More Ads
  return (
    <>
      <Section title="Ad Variants">
        <div className="grid grid-cols-2 gap-1.5">
          {variants.map((variant) => {
            const active = variant.id === activeVariantId;
            return (
              <button
                key={variant.id}
                onClick={() => selectVariant(variant.id)}
                className={`rounded-md border px-3 py-2 text-left text-xs font-bold transition-colors ${
                  active
                    ? "border-accent/40 bg-accent/15 text-accent"
                    : "border-white/5 bg-black/40 hover:border-white/15"
                }`}
              >
                {variant.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => createVariant()}
          className="w-full text-xs flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-accent/15 hover:bg-accent/25 border border-accent/30 text-accent transition-colors"
        >
          <Wand2 className="size-3" /> Generate system ad
        </button>
        <Field label="Custom ad prompt">
          <textarea
            className={`${inputCls} min-h-[86px] resize-none leading-relaxed`}
            placeholder="Example: make a luxury service ad for weekend buyers"
            value={customVariantPrompt}
            onChange={(e) => setCustomVariantPrompt(e.target.value)}
          />
        </Field>
        <button
          onClick={() => {
            const prompt = customVariantPrompt.trim();
            if (!prompt) return;
            createVariant(prompt);
            setCustomVariantPrompt("");
          }}
          disabled={!customVariantPrompt.trim()}
          className="w-full text-xs flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/5 transition-colors disabled:opacity-40"
        >
          <Layers3 className="size-3" /> Create custom ad
        </button>
        <button
          onClick={() => activeVariantId && removeVariant(activeVariantId)}
          disabled={variants.length <= 1}
          className="text-xs text-destructive flex items-center gap-1.5 hover:opacity-80 disabled:opacity-30"
        >
          <Trash2 className="size-3" /> Remove current ad
        </button>
      </Section>
      <Section title="AI Input Settings">
        <Field label="Ad category">
          <select
            className={inputCls}
            value={project.adCategory ?? "local-service"}
            onChange={(e) => patch((p) => ({ ...p, adCategory: e.target.value as AdCategory }))}
          >
            {AD_CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Scene template">
          <select
            className={inputCls}
            value={project.adTemplate ?? "local-business-offer"}
            onChange={(e) => {
              const adTemplate = e.target.value as AdTemplate;
              patch((p) => applyTemplate({ ...p, adTemplate }, adTemplate));
            }}
          >
            {AD_TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>
                {template.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Source type">
          <div className="space-y-1.5">
            <div className="px-3 py-2 rounded-md bg-accent/15 border border-accent/30 text-accent text-xs">
              Website URL
            </div>
            <div className="px-3 py-2 rounded-md bg-black/40 border border-white/5 text-muted-foreground text-xs opacity-60">
              Google Business - coming soon
            </div>
          </div>
        </Field>
        <Field label="Source URL">
          <input className={inputCls} value={project.sourceUrl} readOnly />
        </Field>
        <Field label="Detected tone">
          <div className="text-xs text-muted-foreground">
            {project.script.voiceProfile} - {project.script.musicStyle}
          </div>
        </Field>
      </Section>
    </>
  );
}

function applyTemplate(project: AdProject, template: AdTemplate): AdProject {
  const scenes = project.scenes.map((scene, index) => {
    if (template === "saas-founder-ad") {
      return {
        ...scene,
        headline:
          index === 0
            ? project.brand.brandName
            : index === 1
              ? "Systems. Speed. Scale."
              : scene.headline,
        bullets:
          index === 1
            ? ["Automated workflows", "Multi-agent systems", "Built around your business"]
            : scene.bullets,
      };
    }
    if (template === "luxury-fashion-reel") {
      return {
        ...scene,
        headline:
          index === 0
            ? project.brand.brandName
            : index === 1
              ? "New Season. Sharp Lines."
              : scene.headline,
        bullets:
          index === 1
            ? ["Editorial silhouettes", "Everyday statement pieces", "Designed to move"]
            : scene.bullets,
      };
    }
    if (template === "ugc-review-ad") {
      return {
        ...scene,
        role: index === 2 ? ("proof" as const) : scene.role,
        quote:
          index === 2 ? `The ${project.brand.brandName} experience feels different.` : scene.quote,
        reviewer: index === 2 ? "@verifiedcustomer" : scene.reviewer,
      };
    }
    if (template === "app-demo-spot") {
      return {
        ...scene,
        headline:
          index === 0
            ? project.brand.brandName
            : index === 1
              ? "From Clicks To Outcomes."
              : scene.headline,
        bullets:
          index === 1
            ? ["Show the product", "Explain the workflow", "End with action"]
            : scene.bullets,
      };
    }
    return scene;
  });
  return { ...project, scenes };
}

function addImagesToBrandLibrary(
  brand: AdProject["brand"],
  imageUrls: string[],
): AdProject["brand"] {
  const nextCandidates = prioritizeVisualImages([...imageUrls, ...brand.imageCandidates]);
  const nextSelected = prioritizeVisualImages([...imageUrls, ...brand.selectedImages]).slice(0, 24);
  return {
    ...brand,
    imageCandidates: nextCandidates,
    selectedImages: nextSelected,
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
  return `/api/image?url=${encodeURIComponent(src)}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

declare global {
  interface Window {
    __creativeSparkDragImages?: string[];
  }
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
      patchScript(next as ScriptOutput);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to rewrite");
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
