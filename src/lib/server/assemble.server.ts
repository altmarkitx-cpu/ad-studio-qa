// Server-only: assemble final AdProject from brand + script + qr.
import type { AdProject, BrandProfile, EndCard, Scene, ScriptOutput } from "../types";
import { classifyShot, inferAdCategory, inferAdTemplate } from "./classify.server";
import { detectBrandKind } from "./brandSignals.server";

export function assembleProject(args: {
  id: string;
  sourceUrl: string;
  brand: BrandProfile;
  script: ScriptOutput;
  qrCodeDataUrl: string;
  durationSec?: number;
}): AdProject {
  const duration = args.durationSec ?? 20;
  const images = pickSceneImages(args.brand);
  const kind = detectBrandKind(args.brand);
  const streetwear = kind === "streetwear";
  const fashion = kind === "fashion";
  const ai = kind === "ai";
  const grocery = kind === "grocery";
  const auto = kind === "auto";
  const adCategory = inferAdCategory(args.brand);
  const adTemplate = inferAdTemplate(adCategory);
  const captions = captionsFromScript(args.script.voiceoverScript, 4);

  const scenes: Scene[] = [
    {
      id: "scene-hook",
      role: "hook",
      imageUrl: images[0] ?? images[1] ?? websiteScreenshotUrl(args.brand.websiteUrl),
      shotType: classifyShot(images[0] ?? images[1] ?? args.brand.websiteUrl, 0),
      transitionPreset: "street-cut",
      startSec: 0,
      endSec: 5,
      headline: streetwear ? "Drape Different" : punchyHeadline(args.script.headline, args.brand),
      subtitle: streetwear
        ? "Heavyweight streetwear built for the streets"
        : ai
          ? args.brand.metaDescription || "AI infrastructure built for serious operators."
          : fashion
            ? args.brand.metaDescription || "Fashion-forward pieces for modern wardrobes."
            : auto
              ? args.brand.metaDescription || "A sharper way to find your next vehicle."
              : grocery
                ? args.brand.metaDescription || "Fresh picks and everyday essentials close to home."
                : args.brand.metaDescription ||
                  `Built for people who choose ${args.brand.brandName}.`,
      caption: captions[0],
      transitionType: "fade",
    },
    {
      id: "scene-product",
      role: "product",
      imageUrl: images[1] ?? images[0] ?? websiteScreenshotUrl(args.brand.websiteUrl),
      shotType: classifyShot(images[1] ?? images[0] ?? args.brand.websiteUrl, 1),
      transitionPreset: "hard-flash",
      startSec: 5,
      endSec: 10,
      headline: streetwear
        ? "400GSM. Zero Compromise."
        : ai
          ? "Systems. Speed. Scale."
          : fashion
            ? "New Season. Sharp Lines."
            : auto
              ? "Find The Right Ride."
              : grocery
                ? "Fresh. Local. Ready."
                : "Built With Intent.",
      bullets: streetwear
        ? [
            "Heavyweight loopback cotton",
            "Oversized avant-garde cuts",
            "Custom distress wash treatments",
          ]
        : ai
          ? ["Automated workflows", "Multi-agent systems", "Built around your business"]
          : fashion
            ? ["Editorial silhouettes", "Everyday statement pieces", "Designed to move"]
            : auto
              ? [
                  "New arrivals updated often",
                  "Trusted local service",
                  "Easy shopping from start to finish",
                ]
              : grocery
                ? [
                    "Fresh produce and pantry staples",
                    "Local service you can count on",
                    "Everything for the next shop",
                  ]
                : [
                    "Premium detail and service",
                    "Designed for everyday momentum",
                    "A sharper way to show up",
                  ],
      caption: captions[1],
      transitionType: "fade",
    },
    {
      id: "scene-proof",
      role: "proof",
      imageUrl: images[2] ?? images[1] ?? images[0] ?? websiteScreenshotUrl(args.brand.websiteUrl),
      shotType: classifyShot(images[2] ?? images[1] ?? images[0] ?? args.brand.websiteUrl, 2),
      transitionPreset: "glitch-drop",
      startSec: 10,
      endSec: 15,
      headline: streetwear ? "50,000+ Draped. 4.9★ Rating." : "Loved By Customers.",
      quote: streetwear
        ? "Best heavyweight tee I've owned. Period."
        : ai
          ? `${args.brand.brandName} turns complex operations into clean, automated systems.`
          : fashion
            ? `${args.brand.brandName} brings the season into focus.`
            : auto
              ? `${args.brand.brandName} made finding the right vehicle feel simple.`
              : grocery
                ? `${args.brand.brandName} makes the weekly shop feel easy.`
                : `The ${args.brand.brandName} experience feels different from the first look.`,
      reviewer: streetwear ? "@streetwearfan" : "@verifiedcustomer",
      rating: 4.9,
      caption: captions[2],
      transitionType: "fade",
    },
    {
      id: "scene-endcard",
      role: "endcard",
      imageUrl: images[3] ?? images[2] ?? images[1] ?? websiteScreenshotUrl(args.brand.websiteUrl),
      shotType: classifyShot(images[3] ?? images[2] ?? images[1] ?? args.brand.websiteUrl, 3),
      transitionPreset: "luxury-fade",
      startSec: 15,
      endSec: 20,
      headline: streetwear ? "Shop the Drop" : args.script.cta || "Shop Now",
      subtitle: args.brand.websiteUrl,
      caption: captions[3],
      transitionType: "fade",
    },
  ];

  const endCard: EndCard = {
    companyName: args.brand.brandName,
    websiteUrl: args.brand.websiteUrl,
    phone: args.brand.contactPhone,
    address: args.brand.address,
    accentColor: args.brand.accentColor ?? inferAccent(args.brand),
    logoUrl: args.brand.logoUrl,
    socialHandles: args.brand.socialHandles,
    enabled: true,
  };

  return {
    id: args.id,
    sourceUrl: args.sourceUrl,
    durationSec: duration,
    brand: args.brand,
    script: args.script,
    scenes,
    qrCodeDataUrl: args.qrCodeDataUrl,
    qrDestinationUrl: args.brand.websiteUrl,
    qrEnabled: true,
    bottomBannerEnabled: true,
    endCard,
    formats: ["16:9", "9:16", "1:1"],
    musicGenre: args.script.musicStyle,
    musicBedId: defaultMusicBed(adCategory),
    musicEnabled: true,
    musicVolume: 0.34,
    adCategory,
    adTemplate,
    voiceoverEnabled: true,
    voiceoverVolume: 0.9,
    createdAt: new Date().toISOString(),
  };
}

function pickSceneImages(brand: BrandProfile): string[] {
  const screenshot = websiteScreenshotUrl(brand.websiteUrl);
  const trusted = Array.from(
    new Set([screenshot, ...brand.selectedImages, ...brand.imageCandidates].filter(Boolean)),
  );
  const trustedVisuals = trusted.filter((url) => isScreenshotUrl(url) || !isLogoLike(url));
  const realImages = trustedVisuals.filter((url) => !isScreenshotUrl(url));
  const out = (realImages.length >= 1 ? realImages : trustedVisuals).slice(0, 4);
  if (out.length > 0) {
    const firstReal = realImages[0] ?? out[0] ?? screenshot;
    const secondReal = realImages[1] ?? out[1] ?? firstReal;
    const thirdReal = realImages[2] ?? out[2] ?? secondReal;
    const fourthReal = realImages[3] ?? out[3] ?? thirdReal;
    return [firstReal, secondReal, thirdReal, fourthReal].filter(Boolean);
  }
  return [screenshot, screenshot, screenshot, screenshot];
}

function websiteScreenshotUrl(url: string): string {
  return `https://image.thum.io/get/width/1400/crop/800/noanimate/${encodeURIComponent(url)}`;
}

function isScreenshotUrl(url: string): boolean {
  return /image\.thum\.io\/get\//i.test(url);
}

function isLogoLike(url: string): boolean {
  return /(logo|wordmark|brandmark|favicon|icon)(?:[_\-.?=/]|$)/i.test(url);
}

function punchyHeadline(headline: string, brand: BrandProfile): string {
  const clean = headline?.trim();
  if (clean && clean.length <= 42) return clean;
  return brand.brandName;
}

function inferAccent(brand: BrandProfile): string {
  const text = `${brand.brandName} ${brand.websiteUrl}`.toLowerCase();
  if (text.includes("bluorng") || text.includes("orange")) return "#f97316";
  return "#ffffff";
}

function defaultMusicBed(category: ReturnType<typeof inferAdCategory>): string {
  if (category === "streetwear") return "lofi-street";
  if (category === "fashion") return "fashion-runway";
  if (category === "saas-ai") return "dark-electronic";
  if (category === "luxury-product") return "luxury-ambient";
  return "bright-local";
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
