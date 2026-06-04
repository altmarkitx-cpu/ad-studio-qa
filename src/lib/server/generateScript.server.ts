// Server-only: call Gemini for structured ad copy.
import type { BrandProfile, ScriptOutput } from "../types";
import { detectBrandKind } from "./brandSignals.server";

const SYSTEM_PROMPT = `You are generating copy for a TV-quality 20-second video ad from website data.
Use only the provided brand information. Write concise, cinematic commercial copy.
Never output internal labels such as HERO HOOK, CORE FEATURE, DESIGNED FOR, SOCIAL PROOF, or AD.
Avoid corporate filler. Prefer raw, specific, confident language that fits the brand category.
For streetwear and fashion brands, use an underground, editorial tone instead of generic ecommerce copy.
You are provided with the following real brand assets. You MUST prioritize these assets for the scenes.
Only use a stock-image placeholder if no relevant real asset exists for a critical part of the script.
You MUST only write copy that matches the visuals in the asset list.
If no visual supports a point, make that scene typography-only with bold text and a brand-colored background.
Return valid JSON only with keys: voiceoverScript, headline, cta, bottomBannerText, endCardText, voiceProfile, musicStyle, visualAssetIds.
visualAssetIds must be an array of 4 asset IDs, one for each scene in order. Use "typography-only" when no matching visual exists.`;

export async function generateAdScript(brand: BrandProfile): Promise<ScriptOutput> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallbackScript(brand);

  const userPrompt = `Brand: ${brand.brandName}
Website: ${brand.websiteUrl}
Title: ${brand.metaTitle ?? ""}
Description: ${brand.metaDescription ?? ""}
Phone: ${brand.contactPhone ?? "(none)"}
Address: ${brand.address ?? "(none)"}
Image assets:
${assetPromptList(brand)}

Generate the ad JSON now.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.7,
          },
        }),
      },
    );

    if (!res.ok) throw new Error(`AI gateway ${res.status}`);
    const data = await res.json();
    const text: string =
      data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("") ??
      "{}";
    const parsed = JSON.parse(text);
    return normalizeScript(parsed, brand);
  } catch (err) {
    console.error("[generateAdScript] fallback:", err);
    return fallbackScript(brand);
  }
}

function normalizeScript(raw: unknown, brand: BrandProfile): ScriptOutput {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fallback = fallbackScript(brand);
  return {
    voiceoverScript: stripInternalLabels(String(input.voiceoverScript ?? fallback.voiceoverScript)),
    headline: stripInternalLabels(String(input.headline ?? fallback.headline)),
    cta: stripInternalLabels(String(input.cta ?? fallback.cta)),
    bottomBannerText: stripInternalLabels(
      String(input.bottomBannerText ?? `${brand.brandName} - ${brand.websiteUrl}`),
    ),
    endCardText: stripInternalLabels(String(input.endCardText ?? `Visit ${brand.brandName} today`)),
    voiceProfile: String(input.voiceProfile ?? "Cinematic & deep"),
    musicStyle: String(input.musicStyle ?? fallback.musicStyle),
    visualAssetIds: normalizeVisualAssetIds(input.visualAssetIds, brand),
  };
}

function assetPromptList(brand: BrandProfile): string {
  const assets =
    brand.imageAssets?.slice(0, 40) ??
    brand.selectedImages.slice(0, 20).map((url, index) => ({
      id: `asset-${String(index + 1).padStart(3, "0")}`,
      url,
      kind: "brand",
      alt: "",
      source: "selected",
    }));
  if (assets.length === 0) return "- typography-only: no usable image assets were found";
  return assets
    .map((asset) => {
      const description = [
        asset.kind ? `kind=${asset.kind}` : "",
        asset.alt ? `alt=${asset.alt}` : "",
        asset.source ? `source=${asset.source}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      return `- ${asset.id}: ${description || "brand visual"} | ${asset.url.slice(0, 180)}`;
    })
    .join("\n");
}

function normalizeVisualAssetIds(value: unknown, brand: BrandProfile): string[] {
  const known = new Set((brand.imageAssets ?? []).map((asset) => asset.id));
  if (!Array.isArray(value)) return fallbackAssetIds(brand);
  const ids = value
    .map((item) => String(item))
    .map((item) => item.trim())
    .filter((item) => item === "typography-only" || known.has(item))
    .slice(0, 4);
  return ids.length > 0 ? padAssetIds(ids, brand) : fallbackAssetIds(brand);
}

function fallbackAssetIds(brand: BrandProfile): string[] {
  const ids = (brand.imageAssets ?? []).slice(0, 4).map((asset) => asset.id);
  return padAssetIds(ids, brand);
}

function padAssetIds(ids: string[], brand: BrandProfile): string[] {
  const fallback = brand.imageAssets?.[0]?.id ?? "typography-only";
  return Array.from({ length: 4 }, (_, index) => ids[index] ?? fallback);
}

function fallbackScript(brand: BrandProfile): ScriptOutput {
  const kind = detectBrandKind(brand);
  if (kind === "ai") {
    return {
      voiceoverScript: `${brand.brandName} builds the systems behind modern work. AI agents, automated workflows, and infrastructure designed around your business. Move faster with ${brand.brandName}.`,
      headline: brand.brandName,
      cta: "Book a call",
      bottomBannerText: `${brand.brandName} - ${brand.websiteUrl}`,
      endCardText: `${brand.brandName} - ${brand.websiteUrl}`,
      voiceProfile: "Cinematic & deep",
      musicStyle: "Dark electronic",
      visualAssetIds: fallbackAssetIds(brand),
    };
  }
  if (kind === "fashion") {
    return {
      voiceoverScript: `${brand.brandName} brings the season into focus. Sharp silhouettes, new energy, and looks made to move through the city. Shop the edit now.`,
      headline: brand.brandName,
      cta: "Shop the edit",
      bottomBannerText: `${brand.brandName} - ${brand.websiteUrl}`,
      endCardText: `${brand.brandName} - ${brand.websiteUrl}`,
      voiceProfile: "Cinematic & deep",
      musicStyle: "Fashion editorial",
      visualAssetIds: fallbackAssetIds(brand),
    };
  }
  if (kind === "auto") {
    return {
      voiceoverScript: `${brand.brandName} brings local drivers a sharper way to shop. New arrivals, trusted service, and vehicles ready when you are. Visit ${brand.brandName} today.`,
      headline: brand.brandName,
      cta: "View inventory",
      bottomBannerText: `${brand.brandName} - ${brand.websiteUrl}`,
      endCardText: `${brand.brandName} - ${brand.websiteUrl}`,
      voiceProfile: "Cinematic & deep",
      musicStyle: "Modern commercial",
      visualAssetIds: fallbackAssetIds(brand),
    };
  }
  if (kind === "grocery") {
    return {
      voiceoverScript: `${brand.brandName} brings fresh picks, everyday essentials, and local service together in one place. Stop in today and make the next shop easier.`,
      headline: brand.brandName,
      cta: "Shop today",
      bottomBannerText: `${brand.brandName} - ${brand.websiteUrl}`,
      endCardText: `${brand.brandName} - ${brand.websiteUrl}`,
      voiceProfile: "Warm & confident",
      musicStyle: "Bright local",
      visualAssetIds: fallbackAssetIds(brand),
    };
  }
  return {
    voiceoverScript:
      kind === "streetwear"
        ? `You don't follow trends. You set them. ${brand.brandName}. Heavyweight streetwear for those who drape different. Shop the drop now.`
        : `Meet ${brand.brandName}. ${brand.metaDescription ?? "Local service, trusted choices, and an easier way to get what you need."} Visit today.`,
    headline: kind === "streetwear" ? "Drape Different" : brand.brandName,
    cta: kind === "streetwear" ? "Shop the drop" : "Visit now",
    bottomBannerText: `${brand.brandName} - ${brand.websiteUrl}`,
    endCardText: `${brand.brandName} - ${brand.websiteUrl}`,
    voiceProfile: "Cinematic & deep",
    musicStyle: kind === "streetwear" ? "Lo-fi hip hop" : "Cinematic",
    visualAssetIds: fallbackAssetIds(brand),
  };
}

function stripInternalLabels(value: string): string {
  return value
    .replace(/\b(HERO HOOK|CORE FEATURE|DESIGNED FOR|SOCIAL PROOF|AD)\b[:\s-]*/gi, "")
    .trim();
}
