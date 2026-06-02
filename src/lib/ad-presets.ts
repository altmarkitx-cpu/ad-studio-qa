import type { AdCategory, AdTemplate } from "@/lib/types";

export const AD_CATEGORIES: { id: AdCategory; label: string }[] = [
  { id: "streetwear", label: "Streetwear" },
  { id: "fashion", label: "Fashion" },
  { id: "saas-ai", label: "SaaS / AI" },
  { id: "restaurant-cafe", label: "Restaurant / Cafe" },
  { id: "real-estate", label: "Real Estate" },
  { id: "fitness", label: "Fitness" },
  { id: "local-service", label: "Local Service" },
  { id: "luxury-product", label: "Luxury Product" },
];

export const AD_TEMPLATES: { id: AdTemplate; label: string; category?: AdCategory }[] = [
  { id: "cinematic-product-drop", label: "Cinematic Product Drop", category: "luxury-product" },
  { id: "saas-founder-ad", label: "SaaS Founder Ad", category: "saas-ai" },
  { id: "luxury-fashion-reel", label: "Luxury Fashion Reel", category: "fashion" },
  { id: "local-business-offer", label: "Local Business Offer", category: "local-service" },
  { id: "ugc-review-ad", label: "UGC Review Ad" },
  { id: "app-demo-spot", label: "App Demo Spot", category: "saas-ai" },
];

export const MUSIC_BEDS = [
  { id: "dark-electronic", label: "Dark Electronic", genre: "Dark electronic", bpm: 96 },
  { id: "fashion-runway", label: "Fashion Runway", genre: "Fashion editorial", bpm: 118 },
  { id: "luxury-ambient", label: "Luxury Ambient", genre: "Luxury ambient", bpm: 82 },
  { id: "lofi-street", label: "Lo-fi Street", genre: "Lo-fi hip hop", bpm: 88 },
  { id: "cinematic-pulse", label: "Cinematic Pulse", genre: "Cinematic", bpm: 104 },
  { id: "bright-local", label: "Bright Local", genre: "Upbeat commercial", bpm: 112 },
] as const;

export type MusicBedId = (typeof MUSIC_BEDS)[number]["id"];
