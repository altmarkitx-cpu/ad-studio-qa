import type { AdCategory, AdTemplate, BrandProfile, ShotType } from "../types";
import { detectBrandKind } from "./brandSignals.server";

export function inferAdCategory(brand: BrandProfile): AdCategory {
  const kind = detectBrandKind(brand);
  if (kind === "streetwear") return "streetwear";
  if (kind === "fashion") return "fashion";
  if (kind === "ai") return "saas-ai";
  if (kind === "cafe") return "restaurant-cafe";
  if (kind === "real-estate") return "real-estate";
  if (kind === "fitness") return "fitness";
  if (kind === "luxury") return "luxury-product";
  return "local-service";
}

export function inferAdTemplate(category: AdCategory): AdTemplate {
  if (category === "saas-ai") return "saas-founder-ad";
  if (category === "fashion" || category === "streetwear") return "luxury-fashion-reel";
  if (category === "restaurant-cafe" || category === "local-service") return "local-business-offer";
  if (category === "luxury-product") return "cinematic-product-drop";
  return "ugc-review-ad";
}

export function classifyShot(url: string, index: number): ShotType {
  const lower = url.toLowerCase();
  if (/(logo|wordmark|brand)/.test(lower)) return "brand";
  if (/(detail|close|macro|texture|fabric|ingredient|interior|feature)/.test(lower))
    return "detail";
  if (/(review|ugc|customer|testimonial|person|team|founder|portrait)/.test(lower)) return "ugc";
  if (/(product|shop|item|sku|packshot|case|shirt|dress|shoe|hoodie)/.test(lower)) {
    return "product";
  }
  if (/(hero|banner|cover|lifestyle|street|office|room|gym|restaurant|cafe)/.test(lower)) {
    return "lifestyle";
  }
  return index % 4 === 0
    ? "lifestyle"
    : index % 4 === 1
      ? "product"
      : index % 4 === 2
        ? "detail"
        : "ugc";
}
