import { create } from "zustand";
import type { AdProject, AdVariantData, Scene, ScriptOutput } from "@/lib/types";

export type EditorSection = "slideshow" | "banner" | "endcard" | "qr" | "music" | "voice" | "ai";

export type AdVariant = AdVariantData;

interface EditorState {
  project: AdProject | null;
  activeSceneId: string | null;
  section: EditorSection;
  dirty: boolean;
  time: number;
  playing: boolean;
  past: Scene[][];
  future: Scene[][];
  variants: AdVariant[];
  activeVariantId: string | null;
  setProject: (p: AdProject) => void;
  setSection: (s: EditorSection) => void;
  setActiveScene: (id: string) => void;
  setTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  seekToScene: (id: string) => void;
  setActiveVariant: (id: string | null) => void;
  selectVariant: (id: string) => void;
  createVariant: (prompt?: string) => void;
  removeVariant: (id: string) => void;
  patch: (mut: (p: AdProject) => AdProject) => void;
  /** Mutate scenes with undo/redo history tracking. */
  patchScenes: (next: (scenes: Scene[]) => Scene[]) => void;
  patchScript: (script: ScriptOutput) => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
}

export const useEditor = create<EditorState>((set) => ({
  project: null,
  activeSceneId: null,
  section: "slideshow",
  dirty: false,
  time: 0,
  playing: false,
  past: [],
  future: [],
  variants: [],
  activeVariantId: null,
  setProject: (project) => {
    const savedVariants = normalizeVariants(project);
    const savedActiveVariantId =
      project.activeVariantId ?? project.endCard.editorState?.activeVariantId;
    const activeVariantId =
      savedVariants.find((variant) => variant.id === savedActiveVariantId)?.id ??
      savedVariants[0]?.id ??
      "variant-1";
    const activeVariant = savedVariants.find((variant) => variant.id === activeVariantId);
    const hydratedProject = activeVariant
      ? withProjectVariants(
          {
            ...project,
            script: activeVariant.script,
            scenes: activeVariant.scenes,
            durationSec: sceneDuration(activeVariant.scenes),
          },
          savedVariants,
          activeVariantId,
        )
      : project;
    set({
      project: hydratedProject,
      activeSceneId: hydratedProject.scenes[0]?.id ?? null,
      time: 0,
      playing: false,
      dirty: false,
      past: [],
      future: [],
      variants: savedVariants,
      activeVariantId,
    });
  },
  setSection: (section) => set({ section }),
  setActiveScene: (id) => set({ activeSceneId: id }),
  setTime: (time) =>
    set((s) => {
      const duration = s.project?.durationSec ?? 0;
      const nextTime = Math.max(0, Math.min(duration || time, Number.isFinite(time) ? time : 0));
      const scene =
        s.project?.scenes.find((item) => nextTime >= item.startSec && nextTime < item.endSec) ??
        s.project?.scenes.at(-1);
      return { time: nextTime, activeSceneId: scene?.id ?? s.activeSceneId };
    }),
  setPlaying: (playing) => set({ playing }),
  togglePlaying: () =>
    set((s) => ({
      playing: !s.playing,
      time: s.project && s.time >= s.project.durationSec ? 0 : s.time,
    })),
  seekToScene: (id) =>
    set((s) => {
      const scene = s.project?.scenes.find((item) => item.id === id);
      return {
        activeSceneId: id,
        time: scene?.startSec ?? s.time,
      };
    }),
  setActiveVariant: (id) => set({ activeVariantId: id }),
  selectVariant: (id) =>
    set((s) => {
      if (!s.project) return s;
      const variants = syncActiveVariant(s);
      const next = variants.find((variant) => variant.id === id);
      if (!next) return s;
      return {
        variants,
        project: withProjectVariants(
          {
            ...s.project,
            script: next.script,
            scenes: next.scenes,
            durationSec: sceneDuration(next.scenes),
          },
          variants,
          id,
        ),
        activeVariantId: id,
        activeSceneId: next.scenes[0]?.id ?? null,
        time: 0,
        playing: false,
        past: [],
        future: [],
        dirty: true,
      };
    }),
  createVariant: (prompt) =>
    set((s) => {
      if (!s.project) return s;
      const index = s.variants.length + 1;
      const variant = createVariantFromProject(s.project, index, prompt);
      const variants = syncActiveVariant(s);
      return {
        project: withProjectVariants(
          {
            ...s.project,
            script: variant.script,
            scenes: variant.scenes,
            durationSec: sceneDuration(variant.scenes),
          },
          [...variants, variant],
          variant.id,
        ),
        variants: [...variants, variant],
        activeVariantId: variant.id,
        activeSceneId: variant.scenes[0]?.id ?? null,
        time: 0,
        playing: false,
        past: [],
        future: [],
        dirty: true,
      };
    }),
  removeVariant: (id) =>
    set((s) => {
      if (!s.project || s.variants.length <= 1) return s;
      const synced = syncActiveVariant(s);
      const nextVariants = synced.filter((variant) => variant.id !== id);
      const next = s.activeVariantId === id ? nextVariants[nextVariants.length - 1] : undefined;
      const activeVariantId = next?.id ?? s.activeVariantId;
      const project = next
        ? withProjectVariants(
            {
              ...s.project,
              script: next.script,
              scenes: next.scenes,
              durationSec: sceneDuration(next.scenes),
            },
            nextVariants,
            activeVariantId,
          )
        : withProjectVariants(s.project, nextVariants, activeVariantId);
      return {
        variants: nextVariants,
        project,
        ...(next
          ? {
              activeVariantId: next.id,
              activeSceneId: next.scenes[0]?.id ?? null,
              time: 0,
              playing: false,
              past: [],
              future: [],
            }
          : {}),
        dirty: true,
      };
    }),
  patch: (mut) =>
    set((s) => {
      if (!s.project) return s;
      const project = mut(s.project);
      const variants = syncActiveVariant({ ...s, project });
      return {
        project: withProjectVariants(project, variants, s.activeVariantId),
        variants,
        dirty: true,
      };
    }),
  patchScenes: (next) =>
    set((s) => {
      if (!s.project) return s;
      const prev = s.project.scenes;
      const updated = next(prev);
      const project = { ...s.project, scenes: updated, durationSec: sceneDuration(updated) };
      const variants = syncActiveVariant({ ...s, project });
      return {
        project: withProjectVariants(project, variants, s.activeVariantId),
        variants,
        past: [...s.past, prev].slice(-50),
        future: [],
        dirty: true,
      };
    }),
  patchScript: (script) =>
    set((s) => {
      if (!s.project) return s;
      const project = { ...s.project, script };
      const variants = syncActiveVariant({ ...s, project });
      return {
        project: withProjectVariants(project, variants, s.activeVariantId),
        variants,
        dirty: true,
      };
    }),
  undo: () =>
    set((s) => {
      if (!s.project || s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1];
      const project = { ...s.project, scenes: prev, durationSec: sceneDuration(prev) };
      const variants = syncActiveVariant({ ...s, project });
      return {
        past: s.past.slice(0, -1),
        future: [s.project.scenes, ...s.future].slice(0, 50),
        project: withProjectVariants(project, variants, s.activeVariantId),
        variants,
        dirty: true,
      };
    }),
  redo: () =>
    set((s) => {
      if (!s.project || s.future.length === 0) return s;
      const next = s.future[0];
      const project = { ...s.project, scenes: next, durationSec: sceneDuration(next) };
      const variants = syncActiveVariant({ ...s, project });
      return {
        past: [...s.past, s.project.scenes].slice(-50),
        future: s.future.slice(1),
        project: withProjectVariants(project, variants, s.activeVariantId),
        variants,
        dirty: true,
      };
    }),
  markSaved: () => set({ dirty: false }),
}));

function projectToVariant(project: AdProject, id: string, label: string): AdVariant {
  return {
    id,
    label,
    script: project.script,
    scenes: project.scenes,
  };
}

function normalizeVariants(project: AdProject): AdVariant[] {
  const stored =
    project.variants && project.variants.length > 0
      ? project.variants
      : project.endCard.editorState?.variants;
  if (stored && stored.length > 0) return stored;
  return [projectToVariant(project, "variant-1", "Ad 1")];
}

function withProjectVariants(
  project: AdProject,
  variants: AdVariant[],
  activeVariantId: string | null,
): AdProject {
  return {
    ...project,
    variants,
    activeVariantId: activeVariantId ?? undefined,
    endCard: {
      ...project.endCard,
      editorState: {
        ...project.endCard.editorState,
        variants,
        activeVariantId: activeVariantId ?? undefined,
        qrDestinationUrl: project.qrDestinationUrl,
        qrEnabled: project.qrEnabled,
        bottomBannerEnabled: project.bottomBannerEnabled,
        musicEnabled: project.musicEnabled,
        musicVolume: project.musicVolume,
        voiceoverEnabled: project.voiceoverEnabled,
        voiceoverVolume: project.voiceoverVolume,
      },
    },
  };
}

function syncActiveVariant(state: Pick<EditorState, "variants" | "activeVariantId" | "project">) {
  if (!state.project || !state.activeVariantId) return state.variants;
  return state.variants.map((variant) =>
    variant.id === state.activeVariantId
      ? { ...variant, script: state.project!.script, scenes: state.project!.scenes }
      : variant,
  );
}

function createVariantFromProject(project: AdProject, index: number, prompt?: string): AdVariant {
  const custom = prompt?.trim();
  const rotatedImages = project.scenes.map((scene, sceneIndex, scenes) => ({
    ...scene,
    id: `variant-${index}-scene-${sceneIndex + 1}`,
    imageUrl: scenes[(sceneIndex + index) % scenes.length]?.imageUrl || scene.imageUrl,
    transitionPreset: "luxury-fade",
  }));
  const focus = variantFocus(index, project.brand.brandName);
  const script: ScriptOutput = {
    ...project.script,
    headline: custom ? headlineFromPrompt(custom, project.brand.brandName) : focus.headline,
    cta: custom ? "Visit Today" : index % 2 === 0 ? "Book Your Visit" : "Shop Now",
    voiceoverScript: custom
      ? `${project.brand.brandName} presents ${custom.replace(/[.!?]+$/g, "")}. Explore the experience, compare your options, and visit today.`
      : focus.voiceover,
    bottomBannerText: custom
      ? `${project.brand.brandName} - ${custom.slice(0, 80)}`
      : project.script.bottomBannerText,
  };
  const captions = captionsFromScript(script.voiceoverScript, rotatedImages.length);
  return {
    id: `variant-${crypto.randomUUID()}`,
    label: `Ad ${index}`,
    prompt: custom,
    script,
    scenes: rotatedImages.map((scene, sceneIndex) => ({
      ...scene,
      headline:
        sceneIndex === 0
          ? script.headline
          : sceneIndex === 1
            ? custom
              ? "Built Around This Moment."
              : "New Angle. Same Standard."
            : scene.headline,
      subtitle: sceneIndex === 0 && custom ? custom : scene.subtitle,
      caption: captions[sceneIndex] ?? scene.caption,
    })),
  };
}

function variantFocus(index: number, brandName: string) {
  if (index % 3 === 0) {
    return {
      headline: "Designed To Stand Out.",
      voiceover: `${brandName} brings a sharper way to choose what comes next. Discover the details, feel the difference, and make your move today.`,
    };
  }
  if (index % 2 === 0) {
    return {
      headline: "This Weekend, Make It Yours.",
      voiceover: `${brandName} invites you to explore new arrivals, premium service, and a better way to shop. Visit today and see what is waiting.`,
    };
  }
  return {
    headline: "The Next Move Starts Here.",
    voiceover: `${brandName} turns everyday decisions into a premium experience. See the story, choose your moment, and visit now.`,
  };
}

function headlineFromPrompt(prompt: string, brandName: string): string {
  const clean = prompt.replace(/^create\s+(an?\s+)?ad\s+(for|promoting)?/i, "").trim();
  if (!clean) return brandName;
  const words = clean.split(/\s+/).slice(0, 6);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function sceneDuration(scenes: Scene[]): number {
  return Math.round(
    scenes.reduce((total, scene) => total + Math.max(0, scene.endSec - scene.startSec), 0),
  );
}

function captionsFromScript(script: string, count: number): string[] {
  const sentences = script
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim().replace(/[.!?]+$/g, ""))
    .filter(Boolean);
  const chunks = sentences.length >= count ? sentences : splitIntoChunks(script, count);
  return Array.from({ length: count }, (_, index) => chunks[index] ?? "").map((caption) =>
    caption.length > 96 ? `${caption.slice(0, 93).trim()}...` : caption,
  );
}

function splitIntoChunks(script: string, count: number): string[] {
  const words = script.replace(/\s+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunkSize = Math.max(1, Math.ceil(words.length / count));
  return Array.from({ length: count }, (_, index) =>
    words.slice(index * chunkSize, (index + 1) * chunkSize).join(" "),
  ).filter(Boolean);
}
