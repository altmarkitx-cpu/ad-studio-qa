import type { BrandProfile } from "../types";

export type BrandKind =
  | "streetwear"
  | "fashion"
  | "grocery"
  | "auto"
  | "cafe"
  | "ai"
  | "fitness"
  | "real-estate"
  | "luxury"
  | "local";

export function detectBrandKind(input: BrandProfile | string): BrandKind {
  const text = typeof input === "string" ? input : brandText(input);
  const lower = normalize(text);
  const host = hostFromText(lower);

  if (hasAny(lower, STREETWEAR)) return "streetwear";
  if (hasAny(lower, GROCERY) || hasAny(host, GROCERY_HOSTS)) return "grocery";
  if (hasAny(lower, AUTO) || hasAny(host, AUTO_HOSTS)) return "auto";
  if (hasAny(lower, CAFE) || hasAny(host, CAFE_HOSTS)) return "cafe";
  if (hasAny(lower, FASHION) || hasAny(host, FASHION_HOSTS)) return "fashion";
  if (hasAny(lower, FITNESS)) return "fitness";
  if (hasAny(lower, REAL_ESTATE)) return "real-estate";
  if (hasAny(lower, LUXURY)) return "luxury";
  if (hasAny(lower, AI)) return "ai";
  return "local";
}

export function fallbackDescriptionForKind(kind: BrandKind, brandName: string): string {
  if (kind === "streetwear") return "Heavyweight streetwear built for the streets.";
  if (kind === "fashion") return `${brandName} creates fashion-forward looks for modern wardrobes.`;
  if (kind === "grocery")
    return `${brandName} brings fresh picks, pantry staples, and everyday essentials together.`;
  if (kind === "auto")
    return `${brandName} helps local drivers find the right vehicle with confidence.`;
  if (kind === "cafe") return `${brandName} serves crafted food, drinks, and everyday rituals.`;
  if (kind === "ai")
    return `${brandName} builds digital systems and workflow tools for modern teams.`;
  if (kind === "fitness")
    return `${brandName} helps people train, move, and build better momentum.`;
  if (kind === "real-estate")
    return `${brandName} helps people find property, place, and the next move.`;
  if (kind === "luxury")
    return `${brandName} creates elevated products with detail, craft, and presence.`;
  return `${brandName} offers local service, trusted choices, and an easier way to get what you need.`;
}

function brandText(brand: BrandProfile): string {
  return [
    brand.brandName,
    brand.websiteUrl,
    brand.metaTitle,
    brand.metaDescription,
    brand.category,
    brand.tone,
  ]
    .filter(Boolean)
    .join(" ");
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[_-]+/g, " ");
}

function hostFromText(text: string): string {
  const match = text.match(/https?:\/\/([^/\s]+)/);
  return match?.[1]?.replace(/^www\./, "") ?? text;
}

function hasAny(text: string, terms: RegExp[]): boolean {
  return terms.some((term) => term.test(text));
}

const STREETWEAR = [
  /bluorng/,
  /streetwear/,
  /\bhoodies?\b/,
  /\btees?\b/,
  /\bdrop\b/,
  /\bdrape\b/,
  /oversized/,
];
const FASHION = [
  /\bzara\b/,
  /\bfashion\b/,
  /\bapparel\b/,
  /\bclothing\b/,
  /\bwear\b/,
  /\bstyle\b/,
  /\bwardrobe\b/,
  /\blookbook\b/,
  /\bdenim\b/,
  /\batelier\b/,
  /\bshoes?\b/,
  /\bdresses?\b/,
];
const FASHION_HOSTS = [/zara/, /hm\.com/, /uniqlo/, /mango/, /asos/, /shein/, /nike/, /adidas/];
const GROCERY = [
  /\bgrocery\b/,
  /\bgrocer\b/,
  /\bmarket\b/,
  /\bsupermarket\b/,
  /\bproduce\b/,
  /\bfoods?\b/,
  /\bmart\b/,
  /\bdeli\b/,
  /\bfresh\b/,
  /\bpantry\b/,
  /\bessentials\b/,
  /\borganic\b/,
];
const GROCERY_HOSTS = [
  /wholefoods/,
  /traderjoes/,
  /kroger/,
  /aldi/,
  /publix/,
  /safeway/,
  /instacart/,
  /walmart/,
  /target/,
  /costco/,
];
const AUTO = [
  /\bcadillac\b/,
  /\bford\b/,
  /\btoyota\b/,
  /\bhonda\b/,
  /\bbmw\b/,
  /\bmercedes\b/,
  /\bchevrolet\b/,
  /\bdealer\b/,
  /\bdealership\b/,
  /\bauto\b/,
  /\bvehicle\b/,
  /\bcars?\b/,
  /\binventory\b/,
];
const AUTO_HOSTS = [/cadillac/, /ford/, /toyota/, /honda/, /bmw/, /mercedes/, /chevrolet/, /cars/];
const CAFE = [
  /\bcoffee\b/,
  /\bcafe\b/,
  /\bespresso\b/,
  /\broast\b/,
  /\blatte\b/,
  /\bbakery\b/,
  /\bdining\b/,
  /\brestaurant\b/,
];
const CAFE_HOSTS = [/coffee/, /cafe/, /bakery/, /restaurant/];
const AI = [
  /\bai\b/,
  /artificial intelligence/,
  /\bautomation\b/,
  /\bagents?\b/,
  /\bworkflow\b/,
  /\binfrastructure\b/,
  /\bsoftware\b/,
  /\bsaas\b/,
  /markitx/,
];
const FITNESS = [
  /\bgym\b/,
  /\bfitness\b/,
  /\btraining\b/,
  /\byoga\b/,
  /\bwellness\b/,
  /\bcoach\b/,
  /\bworkout\b/,
];
const REAL_ESTATE = [
  /\breal estate\b/,
  /\brealtor\b/,
  /\bproperty\b/,
  /\bhomes?\b/,
  /\bapartments?\b/,
  /\bcondo\b/,
  /\blisting\b/,
];
const LUXURY = [
  /\bluxury\b/,
  /\bjewelry\b/,
  /\bwatch\b/,
  /\bperfume\b/,
  /\bskincare\b/,
  /\binterior\b/,
  /\bfurniture\b/,
];
