// Fallback brand profiles used when extraction fails or yields too little.
import type { BrandProfile } from "../types";
import { detectBrandKind, fallbackDescriptionForKind, type BrandKind } from "./brandSignals.server";

export const FASHION_MOCK: BrandProfile = {
  brandName: "Velasco Denim",
  websiteUrl: "https://velasco-denim.example",
  metaTitle: "Velasco Denim — Raw Heritage",
  metaDescription: "Premium raw denim crafted to age with you.",
  tone: "Confident, premium",
  category: "Fashion",
  accentColor: "#6366f1",
  imageCandidates: [],
  selectedImages: [
    "https://images.unsplash.com/photo-1593030761757-71fae45fa0e7?w=1200",
    "https://images.unsplash.com/photo-1521577352947-9bb58764b69a?w=1200",
    "https://images.unsplash.com/photo-1542272604-787c3835535d?w=1200",
    "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=1200",
    "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1200",
  ],
};

export const CAFE_MOCK: BrandProfile = {
  brandName: "Aurora Coffee",
  websiteUrl: "https://aurora-coffee.example",
  metaTitle: "Aurora Coffee — Morning Ritual",
  metaDescription: "Small-batch dark roast for early risers.",
  tone: "Warm, inviting",
  category: "Cafe",
  accentColor: "#6366f1",
  contactPhone: "+1 415 555 0142",
  address: "221 Hayes Street, San Francisco",
  imageCandidates: [],
  selectedImages: [
    "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200",
    "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200",
    "https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=1200",
    "https://images.unsplash.com/photo-1559496417-e7f25cb247f3?w=1200",
    "https://images.unsplash.com/photo-1453614512568-c4024d13c247?w=1200",
  ],
};

export const AI_AGENCY_MOCK: BrandProfile = {
  brandName: "AI Studio",
  websiteUrl: "https://ai-studio.example",
  metaTitle: "AI Studio - Automation Infrastructure",
  metaDescription: "AI systems, automation, and intelligent workflows for growing teams.",
  tone: "Sharp, technical, confident",
  category: "AI Agency",
  accentColor: "#7c3aed",
  imageCandidates: [],
  selectedImages: [
    "https://images.unsplash.com/photo-1639322537228-f710d846310a?w=1800",
    "https://images.unsplash.com/photo-1550751827-4bd374c3f58b?w=1800",
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=1800",
    "https://images.unsplash.com/photo-1551434678-e076c223a692?w=1800",
  ],
};

export const LOCAL_BUSINESS_MOCK: BrandProfile = {
  brandName: "Local Market",
  websiteUrl: "https://local-market.example",
  metaTitle: "Local Market - Everyday essentials",
  metaDescription: "Fresh picks, trusted service, and everyday essentials close to home.",
  tone: "Warm, practical, trustworthy",
  category: "Local Business",
  accentColor: "#22c55e",
  imageCandidates: [],
  selectedImages: [
    "https://images.unsplash.com/photo-1542838132-92c53300491e?w=1800",
    "https://images.unsplash.com/photo-1578916171728-46686eac8d58?w=1800",
    "https://images.unsplash.com/photo-1601599963565-b7ba29c8e8d4?w=1800",
    "https://images.unsplash.com/photo-1534723452862-4c874018d66d?w=1800",
  ],
};

export const AUTO_MOCK: BrandProfile = {
  brandName: "City Auto",
  websiteUrl: "https://city-auto.example",
  metaTitle: "City Auto - Find your next vehicle",
  metaDescription: "New arrivals, trusted service, and a better way to find your next vehicle.",
  tone: "Polished, confident, local",
  category: "Auto Dealer",
  accentColor: "#2563eb",
  imageCandidates: [],
  selectedImages: [
    "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=1800",
    "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1800",
    "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1800",
    "https://images.unsplash.com/photo-1542362567-b07e54358753?w=1800",
  ],
};

export const BLUORNG_MOCK: BrandProfile = {
  brandName: "BLUORNG",
  websiteUrl: "https://bluorng.com/",
  metaTitle: "BLUORNG - Streetwear",
  metaDescription: "Heavyweight streetwear built for the streets.",
  tone: "Dark, raw, street",
  category: "Streetwear",
  accentColor: "#f97316",
  socialHandles: {
    instagram: "@bluorng",
    tiktok: "@bluorng",
  },
  imageCandidates: [],
  selectedImages: [
    "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1800",
    "https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=1800",
    "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=1800",
    "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=1800",
  ],
};

export function createFallbackBrandForUrl(url: string): BrandProfile {
  const host = safeHost(url);
  const brandName = brandNameFromHost(host);
  const kind = detectBrandKind(`${url} ${brandName}`);
  const base =
    kind === "streetwear"
      ? BLUORNG_MOCK
      : kind === "fashion"
        ? FASHION_MOCK
        : kind === "cafe"
          ? CAFE_MOCK
          : kind === "ai"
            ? AI_AGENCY_MOCK
            : kind === "auto"
              ? AUTO_MOCK
              : LOCAL_BUSINESS_MOCK;

  return {
    ...base,
    brandName,
    websiteUrl: url,
    metaTitle: `${brandName} - ${base.category}`,
    metaDescription: fallbackDescriptionForKind(kind, brandName),
    category: base.category,
    imageCandidates: [websiteScreenshotUrl(url)],
    selectedImages: [websiteScreenshotUrl(url)],
    socialHandles: undefined,
  };
}

export function padImages(images: string[], brand?: BrandProfile): string[] {
  if (images.length >= 5) return images.slice(0, 8);
  const filler = fallbackImagesForBrand(brand);
  const out = [...images];
  while (out.length < 5) out.push(filler[out.length % filler.length]);
  return out;
}

export function fallbackImagesForBrand(brand?: BrandProfile): string[] {
  const kind = inferBrandKind(
    `${brand?.brandName ?? ""} ${brand?.websiteUrl ?? ""} ${brand?.metaTitle ?? ""} ${brand?.metaDescription ?? ""} ${brand?.category ?? ""}`,
  );
  if (kind === "streetwear") return BLUORNG_MOCK.selectedImages;
  if (kind === "fashion") return FASHION_MOCK.selectedImages;
  if (kind === "cafe") return CAFE_MOCK.selectedImages;
  if (kind === "ai") return AI_AGENCY_MOCK.selectedImages;
  if (kind === "auto") return AUTO_MOCK.selectedImages;
  return LOCAL_BUSINESS_MOCK.selectedImages;
}

function inferBrandKind(text: string): "streetwear" | "fashion" | "cafe" | "ai" | "auto" | "local" {
  const kind = detectBrandKind(text);
  if (kind === "streetwear") return "streetwear";
  if (kind === "fashion") {
    return "fashion";
  }
  if (kind === "auto") return "auto";
  if (kind === "cafe") return "cafe";
  if (kind === "ai") return "ai";
  return "local";
}

function descriptionForKind(kind: BrandKind, brandName: string): string {
  return fallbackDescriptionForKind(kind, brandName);
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0];
  }
}

function brandNameFromHost(host: string): string {
  const first = host.split(".")[0] || "Brand";
  if (first.length <= 4) return first.toUpperCase();
  return first
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function websiteScreenshotUrl(url: string): string {
  return `https://image.thum.io/get/width/1400/crop/800/noanimate/${encodeURIComponent(url)}`;
}
