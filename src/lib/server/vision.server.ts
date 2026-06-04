import type { BrandImageAsset, BrandProfile, ShotType } from "../types";
import { classifyShot } from "./classify.server";

const SHOT_TYPES: ShotType[] = ["lifestyle", "product", "detail", "ugc", "brand"];

export async function classifyShotsWithGemini(args: {
  brand: BrandProfile;
  assets: BrandImageAsset[];
}): Promise<ShotType[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  const assets = args.assets.slice(0, 4);
  if (!apiKey || assets.length === 0) {
    return assets.map((asset, index) => classifyShot(asset.url, index));
  }

  try {
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      {
        text:
          `Classify each image into exactly one shot type for a commercial ad: ${SHOT_TYPES.join(", ")}.\n` +
          `Brand: ${args.brand.brandName}\n` +
          `Category: ${args.brand.category ?? "unknown"}\n` +
          `Return JSON only like {"shotTypes":["lifestyle","product","detail","ugc"]}.\n` +
          `Use the actual visuals. If an image is unclear, choose the closest commercial shot type.`,
      },
    ];

    for (const asset of assets) {
      const image = await fetchImageForVision(asset.url).catch(() => null);
      if (image) {
        parts.push({ text: `Asset ${asset.id}: ${asset.alt ?? asset.kind ?? asset.source ?? ""}` });
        parts.push({ inlineData: image });
      } else {
        parts.push({
          text: `Asset ${asset.id}: ${asset.alt ?? asset.kind ?? asset.source ?? "brand visual"} | ${asset.url}`,
        });
      }
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini shot classifier ${res.status}`);
    const data = await res.json();
    const text: string =
      data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join(
        "",
      ) ?? "{}";
    const parsed = JSON.parse(text) as { shotTypes?: unknown };
    const shotTypes = Array.isArray(parsed.shotTypes) ? parsed.shotTypes : [];
    const normalized = shotTypes
      .map((value) => String(value).toLowerCase().trim())
      .map((value) => (SHOT_TYPES.includes(value as ShotType) ? (value as ShotType) : null))
      .filter((value): value is ShotType => Boolean(value));
    return normalized.length > 0
      ? normalized.slice(0, 4)
      : assets.map((asset, index) => classifyShot(asset.url, index));
  } catch (error) {
    console.error("[classifyShotsWithGemini]", error);
    return assets.map((asset, index) => classifyShot(asset.url, index));
  }
}

async function fetchImageForVision(url: string): Promise<{ mimeType: string; data: string } | null> {
  if (/^data:image\//i.test(url)) {
    const match = url.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/i);
    if (!match?.[2]) return null;
    return { mimeType: match[1] || "image/png", data: match[2] };
  }
  const res = await fetch(url, {
    headers: {
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
      Referer: imageReferer(url),
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`Image responded ${res.status}`);
  const mimeType = res.headers.get("content-type") || "image/jpeg";
  if (!mimeType.startsWith("image/")) throw new Error("Not an image");
  const arrayBuffer = await res.arrayBuffer();
  return { mimeType, data: arrayBufferToBase64(arrayBuffer) };
}

function imageReferer(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "https://www.google.com/";
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
