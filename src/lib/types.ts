export interface BrandProfile {
  brandName: string;
  websiteUrl: string;
  metaTitle?: string;
  metaDescription?: string;
  tone?: string;
  category?: string;
  accentColor?: string;
  logoUrl?: string;
  socialHandles?: {
    instagram?: string;
    tiktok?: string;
  };
  contactPhone?: string;
  address?: string;
  imageCandidates: string[];
  selectedImages: string[];
  imageAssets?: BrandImageAsset[];
}

export interface ScriptOutput {
  voiceoverScript: string;
  headline: string;
  cta: string;
  bottomBannerText: string;
  endCardText: string;
  voiceProfile: string;
  musicStyle: string;
  visualAssetIds?: string[];
}

export interface BrandImageAsset {
  id: string;
  url: string;
  alt?: string;
  source?: string;
  score?: number;
  width?: number;
  height?: number;
  kind?: "hero" | "product" | "lifestyle" | "logo" | "detail" | "ugc" | "brand";
}

export interface AdVariantData {
  id: string;
  label: string;
  prompt?: string;
  script: ScriptOutput;
  scenes: Scene[];
}

export type TransitionType =
  | "cut"
  | "fade"
  | "slide"
  | "zoom"
  | "street-cut"
  | "luxury-fade"
  | "glitch-drop"
  | "hard-flash";
export type SceneRole = "hook" | "product" | "proof" | "endcard";
export type AdFormat = "16:9" | "9:16" | "1:1";
export type ShotType = "hero" | "lifestyle" | "product" | "detail" | "ugc" | "brand";
export type TransitionPreset = "street-cut" | "luxury-fade" | "glitch-drop" | "hard-flash";
export type AdCategory =
  | "streetwear"
  | "fashion"
  | "saas-ai"
  | "restaurant-cafe"
  | "real-estate"
  | "fitness"
  | "local-service"
  | "luxury-product";
export type AdTemplate =
  | "cinematic-product-drop"
  | "saas-founder-ad"
  | "luxury-fashion-reel"
  | "local-business-offer"
  | "ugc-review-ad"
  | "app-demo-spot";
export type TextAnchor = "top-left" | "center" | "bottom-left" | "bottom-center";

export interface Scene {
  id: string;
  role?: SceneRole;
  shotType?: ShotType;
  transitionPreset?: TransitionPreset;
  imageUrl: string;
  visualAssetId?: string;
  startSec: number;
  endSec: number;
  headline?: string;
  subtitle?: string;
  bullets?: string[];
  quote?: string;
  reviewer?: string;
  rating?: number;
  caption?: string;
  transitionType?: TransitionType;
  formatLayouts?: Partial<
    Record<
      AdFormat,
      {
        textAnchor?: TextAnchor;
        imageX?: number;
        imageY?: number;
        imageScale?: number;
        imageOpacity?: number;
        imageFit?: "cover" | "contain";
        textSize?: number;
        subtitleSize?: number;
        textColor?: string;
        textAlign?: "left" | "center" | "right";
        overlayOpacity?: number;
      }
    >
  >;
}

export interface EndCard {
  companyName: string;
  websiteUrl: string;
  phone?: string;
  address?: string;
  accentColor?: string;
  backgroundColor?: string;
  logoUrl?: string;
  socialHandles?: {
    instagram?: string;
    tiktok?: string;
  };
  enabled?: boolean;
  editorState?: {
    variants?: AdVariantData[];
    activeVariantId?: string;
    qrDestinationUrl?: string;
    qrEnabled?: boolean;
    bottomBannerEnabled?: boolean;
    musicEnabled?: boolean;
    musicVolume?: number;
    voiceoverEnabled?: boolean;
    voiceoverVolume?: number;
  };
}

export interface AdProject {
  id: string;
  sourceUrl: string;
  durationSec: number;
  brand: BrandProfile;
  script: ScriptOutput;
  scenes: Scene[];
  qrCodeDataUrl: string;
  qrDestinationUrl?: string;
  qrEnabled?: boolean;
  bottomBannerEnabled?: boolean;
  endCard: EndCard;
  formats?: AdFormat[];
  musicGenre?: string;
  musicAudioDataUrl?: string;
  musicAudioName?: string;
  musicBedId?: string;
  musicEnabled?: boolean;
  musicVolume?: number;
  adCategory?: AdCategory;
  adTemplate?: AdTemplate;
  voiceAudioUrl?: string;
  voiceoverAudioDataUrl?: string;
  voiceoverAudioName?: string;
  voiceoverEnabled?: boolean;
  voiceoverVolume?: number;
  variants?: AdVariantData[];
  activeVariantId?: string;
  createdAt: string;
}

export type JobStatus = "pending" | "fetching" | "extracting" | "generating" | "done" | "failed";

export interface StepLog {
  step: string;
  status: "running" | "done" | "failed";
  at: string;
  detail?: string;
}

export const MUSIC_GENRES = [
  "Acoustic",
  "Afrobeat",
  "Chill",
  "Corporate",
  "Electro",
  "Latin",
  "Rock",
] as const;

export const VOICE_PROFILES = [
  "Warm & inviting",
  "Confident & articulate",
  "Energetic & young",
  "Cinematic & deep",
  "Trustworthy & clear",
  "Friendly & casual",
] as const;

export const SHOT_TYPES: ShotType[] = ["hero", "product", "detail", "lifestyle", "ugc"];

export const SHOT_COLORS: Record<ShotType, string> = {
  hero: "#f43f5e",
  product: "#6366f1",
  detail: "#06b6d4",
  lifestyle: "#10b981",
  ugc: "#f59e0b",
  brand: "#a855f7",
};

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  cut: "Hard Cut",
  fade: "Soft Fade",
  slide: "Slide",
  zoom: "Zoom",
  "street-cut": "Street Cut",
  "luxury-fade": "Luxury Fade",
  "glitch-drop": "Glitch Drop",
  "hard-flash": "Hard Flash",
};
