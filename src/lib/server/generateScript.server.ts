// Server-only: call Lovable AI Gateway for structured ad copy.
import type { BrandProfile, ScriptOutput } from "../types";
import { detectBrandKind } from "./brandSignals.server";

const SYSTEM_PROMPT = `You are generating copy for a TV-quality 20-second video ad from website data.
Use only the provided brand information. Write concise, cinematic commercial copy.
Never output internal labels such as HERO HOOK, CORE FEATURE, DESIGNED FOR, SOCIAL PROOF, or AD.
Avoid corporate filler. Prefer raw, specific, confident language that fits the brand category.
For streetwear and fashion brands, use an underground, editorial tone instead of generic ecommerce copy.
Return valid JSON only with keys: voiceoverScript, headline, cta, bottomBannerText, endCardText, voiceProfile, musicStyle.`;

export async function generateAdScript(brand: BrandProfile): Promise<ScriptOutput> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return fallbackScript(brand);

  const userPrompt = `Brand: ${brand.brandName}
Website: ${brand.websiteUrl}
Title: ${brand.metaTitle ?? ""}
Description: ${brand.metaDescription ?? ""}
Phone: ${brand.contactPhone ?? "(none)"}
Address: ${brand.address ?? "(none)"}

Generate the ad JSON now.`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) throw new Error(`AI gateway ${res.status}`);
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "{}";
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
  };
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
  };
}

function stripInternalLabels(value: string): string {
  return value
    .replace(/\b(HERO HOOK|CORE FEATURE|DESIGNED FOR|SOCIAL PROOF|AD)\b[:\s-]*/gi, "")
    .trim();
}
