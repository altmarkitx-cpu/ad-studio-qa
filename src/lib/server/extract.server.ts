// Server-only: parse HTML and build a BrandProfile.
import * as cheerio from "cheerio";
import type { BrandImageAsset, BrandProfile } from "../types";

type ImageCandidate = {
  url: string;
  score: number;
  alt?: string;
  source?: string;
  width?: number;
  height?: number;
  kind?: BrandImageAsset["kind"];
};

const IMAGE_ATTRIBUTES = [
  "src",
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-master",
  "data-image",
  "data-image-url",
  "data-bg",
  "data-background",
  "data-background-image",
  "data-zoom-image",
  "data-large-image",
  "poster",
] as const;

function abs(base: string, href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function addImage(
  images: ImageCandidate[],
  baseUrl: string,
  rawUrl: string | undefined,
  score: number,
  meta: Omit<ImageCandidate, "url" | "score"> = {},
) {
  const cleaned = cleanImageUrl(rawUrl);
  if (!cleaned) return;
  if (cleaned.startsWith("data:image/")) {
    if (!/screenshot|capture|protected/i.test(`${meta.source ?? ""} ${rawUrl ?? ""}`) && score < 70) {
      return;
    }
    images.push({ url: cleaned, score, ...meta });
    return;
  }
  const url = abs(baseUrl, cleaned);
  if (!url || !isLikelyImage(url)) return;
  if (isKnownTiny(meta.width, meta.height)) return;
  images.push({ url, score, ...meta });
}

function cleanImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed || trimmed.startsWith("data:")) return undefined;
  return trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
}

function isLikelyImage(url: string): boolean {
  const lower = url.toLowerCase();
  if (/(favicon|sprite|icon|loader|spinner|placeholder|transparent|pixel|tracking)/.test(lower)) {
    return false;
  }
  return (
    /\.(avif|gif|jpe?g|png|webp)(\?|$)/i.test(lower) ||
    /\/cdn\/shop\/files\//i.test(lower) ||
    /images\.unsplash\.com/i.test(lower) ||
    /cdn-images|image\.|images\.|assets\.|media\.|static\./i.test(lower) ||
    /[?&](?:format|fm|auto|fit|width|w|height|h)=/i.test(lower)
  );
}

function parseSrcset(srcset: string | undefined): { url: string; width: number }[] {
  if (!srcset) return [];
  return srcset
    .split(",")
    .map((candidate) => {
      const [url, descriptor = ""] = candidate.trim().split(/\s+/);
      const width = descriptor.endsWith("w")
        ? Number(descriptor.slice(0, -1))
        : descriptor.endsWith("x")
          ? Number(descriptor.slice(0, -1)) * 800
          : 0;
      return { url, width: Number.isFinite(width) ? width : 0 };
    })
    .filter((candidate) => Boolean(candidate.url))
    .sort((a, b) => b.width - a.width);
}

function bestSrcsetUrl(srcset: string | undefined): { url: string; width?: number } | null {
  const candidates = parseSrcset(srcset);
  const best = candidates[0];
  return best ? { url: best.url, width: best.width || undefined } : null;
}

function extractCssUrls(value: string | undefined): string[] {
  if (!value) return [];
  return Array.from(value.matchAll(/url\(([^)]+)\)/gi), (match) => match[1]);
}

function scoreImage(src: string, alt: string, w?: number, h?: number, source = ""): number {
  let score = 0;
  const hintedWidth = w || getWidthHint(src);
  const hintedHeight = h || getHeightHint(src);
  if (hintedWidth && hintedHeight) score += Math.min((hintedWidth * hintedHeight) / 10000, 50);
  if ((hintedWidth && hintedWidth > 800) || (hintedHeight && hintedHeight > 800)) score += 30;
  else if (hintedWidth && hintedWidth >= 600) score += 20;
  if (alt && alt.length > 4) score += 10;
  const lower = src.toLowerCase();
  if (/(hero|banner|cover)/.test(lower) || /hero|banner|cover/i.test(source)) score += 50;
  if (/(product|shop|sku|item)/.test(lower) || /product|shop|sku|item/i.test(source)) score += 50;
  if (/(lifestyle|lookbook|street|editorial|gallery)/.test(lower)) score += 50;
  if (/(detail|texture|macro|close)/.test(lower)) score += 28;
  if (/(favicon|icon|logo-small|sprite|avatar|pixel|tracking|tracker|placeholder)/.test(lower)) {
    score -= 100;
  }
  if (/(logo|wordmark|brandmark)/.test(lower)) score -= 45;
  if (/\.svg($|\?)/.test(lower)) score -= 15;
  if (/(\.gif)($|\?)/.test(lower)) score -= 10;
  return score;
}

function inferImageKind(src: string, alt = "", source = ""): BrandImageAsset["kind"] {
  const text = `${src} ${alt} ${source}`.toLowerCase();
  if (/(logo|wordmark|brandmark|favicon)/.test(text)) return "logo";
  if (/(hero|banner|cover|main)/.test(text)) return "hero";
  if (/(product|shop|sku|item|pdp|catalog)/.test(text)) return "product";
  if (/(detail|texture|macro|close|fabric|feature)/.test(text)) return "detail";
  if (/(ugc|review|customer|testimonial|wearing)/.test(text)) return "ugc";
  if (/(lifestyle|lookbook|editorial|street|gallery)/.test(text)) return "lifestyle";
  return "brand";
}

function isKnownTiny(width?: number, height?: number): boolean {
  return Boolean(width && height && (width < 200 || height < 200));
}

export function extractFromHtml(html: string, baseUrl: string): BrandProfile {
  const $ = cheerio.load(html);

  const metaTitle =
    $('meta[property="og:title"]').attr("content") ||
    $('meta[name="twitter:title"]').attr("content") ||
    $("title").first().text().trim();

  const metaDescription =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";

  const ogImage = abs(baseUrl, $('meta[property="og:image"]').attr("content"));
  const twitterImage = abs(baseUrl, $('meta[name="twitter:image"]').attr("content"));
  const itempropImage = abs(baseUrl, $('[itemprop="image"]').first().attr("content"));
  const captureImage = $('meta[name="adstudio-screenshot"]').attr("content");
  const screenshotFallback = websiteScreenshotUrl(baseUrl);
  const favicon =
    abs(baseUrl, $('link[rel="icon"]').attr("href")) ||
    abs(baseUrl, $('link[rel="shortcut icon"]').attr("href")) ||
    abs(baseUrl, $('link[rel="apple-touch-icon"]').attr("href"));
  const logoImage = $("img")
    .toArray()
    .map((el) => ({
      src: abs(baseUrl, $(el).attr("src") || $(el).attr("data-src")),
      alt: ($(el).attr("alt") || "").toLowerCase(),
      className: ($(el).attr("class") || "").toLowerCase(),
      id: ($(el).attr("id") || "").toLowerCase(),
    }))
    .find(
      (img) => img.src && /(logo|brand|wordmark)/.test(`${img.alt} ${img.className} ${img.id}`),
    )?.src;

  const themeColor =
    normalizeColor($('meta[name="theme-color"]').attr("content")) || inferAccent(baseUrl);

  // Brand name candidates
  const siteName = $('meta[property="og:site_name"]').attr("content")?.trim();
  const host = (() => {
    try {
      return new URL(baseUrl).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const domainName = host.split(".")[0] || "";
  const brandName =
    siteName ||
    metaTitle?.split(/[|\-–—:]/)[0]?.trim() ||
    domainName.charAt(0).toUpperCase() + domainName.slice(1);

  // Hero text
  const heroText =
    $("h1").first().text().trim() || $("h2").first().text().trim() || metaDescription;

  // Image candidates
  const imageScores: ImageCandidate[] = [];
  $("img").each((_, el) => {
    const alt = $(el).attr("alt") || "";
    const w = parseInt($(el).attr("width") || "0", 10) || undefined;
    const h = parseInt($(el).attr("height") || "0", 10) || undefined;
    const source = `${$(el).attr("class") || ""} ${$(el).attr("id") || ""}`;
    for (const attr of IMAGE_ATTRIBUTES) {
      const raw = $(el).attr(attr);
      const score = scoreImage(raw ?? "", alt, w, h, `${source} ${attr}`);
      addImage(imageScores, baseUrl, raw, score, {
        alt,
        source: `img:${attr}`,
        width: w,
        height: h,
        kind: inferImageKind(raw ?? "", alt, source),
      });
    }
    const best = bestSrcsetUrl($(el).attr("srcset") || $(el).attr("data-srcset"));
    if (best) {
      addImage(imageScores, baseUrl, best.url, scoreImage(best.url, alt, best.width, h, source) + 10, {
        alt,
        source: "img:srcset",
        width: best.width,
        height: h,
        kind: inferImageKind(best.url, alt, source),
      });
    }
  });

  $("source").each((_, el) => {
    const best = bestSrcsetUrl($(el).attr("srcset") || $(el).attr("data-srcset"));
    if (best) {
      addImage(
        imageScores,
        baseUrl,
        best.url,
        scoreImage(best.url, "", best.width, undefined, "picture source") + 12,
        {
          source: "picture:source",
          width: best.width,
          kind: inferImageKind(best.url, "", "picture source"),
        },
      );
    }
  });

  $(
    'link[rel="preload"][as="image"], link[rel="image_src"], link[rel="preload"][type^="image/"]',
  ).each((_, el) => {
    addImage(imageScores, baseUrl, $(el).attr("href"), 60);
    const best = bestSrcsetUrl($(el).attr("imagesrcset"));
    if (best) {
      addImage(imageScores, baseUrl, best.url, 70, {
        source: "link:imagesrcset",
        width: best.width,
        kind: inferImageKind(best.url, "", "preload"),
      });
    }
  });

  $("[style]").each((_, el) => {
    for (const cssUrl of extractCssUrls($(el).attr("style"))) {
      addImage(imageScores, baseUrl, cssUrl, 34, {
        source: "style-attribute",
        kind: inferImageKind(cssUrl, "", $(el).attr("class") || ""),
      });
    }
  });

  $("style").each((_, el) => {
    for (const cssUrl of extractCssUrls($(el).text())) {
      addImage(imageScores, baseUrl, cssUrl, 32, {
        source: "style-tag",
        kind: inferImageKind(cssUrl, "", "css"),
      });
    }
  });

  $("*").each((_, el) => {
    const source = `${$(el).prop("tagName") || ""} ${$(el).attr("class") || ""} ${$(el).attr("id") || ""}`;
    for (const attr of IMAGE_ATTRIBUTES) {
      if (attr === "src") continue;
      const raw = $(el).attr(attr);
      addImage(imageScores, baseUrl, raw, scoreImage(raw ?? "", "", undefined, undefined, source), {
        source: `attr:${attr}`,
        kind: inferImageKind(raw ?? "", "", source),
      });
    }
  });

  $('script[type="application/ld+json"]').each((_, el) => {
    for (const url of extractJsonImageUrls($(el).text())) {
      addImage(imageScores, baseUrl, url, 78, {
        source: "json-ld",
        kind: inferImageKind(url, "", "json-ld"),
      });
    }
  });
  if (ogImage) imageScores.push({ url: ogImage, score: 125, source: "meta:og:image", kind: "hero" });
  if (twitterImage)
    imageScores.push({ url: twitterImage, score: 120, source: "meta:twitter:image", kind: "hero" });
  if (itempropImage)
    imageScores.push({ url: itempropImage, score: 112, source: "itemprop:image", kind: "product" });
  if (captureImage) imageScores.push({ url: captureImage, score: 135, source: "meta:adstudio-screenshot", kind: "hero" });
  for (const url of extractImageUrlsFromText(html)) {
    addImage(imageScores, baseUrl, url, scoreImage(url, "", undefined, undefined, "text") + 12, {
      source: "html-text",
      kind: inferImageKind(url, "", "html-text"),
    });
  }

  // Dedupe + sort. Shopify often repeats the same image at many widths.
  const bestByImage = new Map<string, ImageCandidate>();
  for (const image of imageScores) {
    if (image.score <= 0) continue;
    const key = canonicalImageKey(image.url);
    const existing = bestByImage.get(key);
    if (
      !existing ||
      image.score > existing.score ||
      getWidthHint(image.url) > getWidthHint(existing.url)
    ) {
      bestByImage.set(key, image);
    }
  }
  const sorted = Array.from(bestByImage.values()).sort((a, b) => b.score - a.score);

  const realSorted = sorted.filter((asset) => asset.source !== "screenshot" && asset.score > 0);
  const fallbackScreenshotAsset: ImageCandidate = {
    url: screenshotFallback,
    score: 1,
    source: "screenshot-fallback",
    kind: "hero",
  };
  const finalAssets = realSorted.length > 0 ? realSorted : [fallbackScreenshotAsset];
  const imageCandidates = finalAssets.map((s) => s.url);
  const selectedImages = finalAssets.map((s) => s.url).slice(0, 80);
  const imageAssets = finalAssets.slice(0, 120).map((asset, index) => ({
    id: `asset-${String(index + 1).padStart(3, "0")}`,
    url: asset.url,
    alt: asset.alt,
    source: asset.source,
    score: Math.round(asset.score),
    width: asset.width,
    height: asset.height,
    kind: asset.kind ?? inferImageKind(asset.url, asset.alt, asset.source),
  }));

  // Contact info
  const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 8000);
  const phoneMatch = bodyText.match(
    /(\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/,
  );
  const contactPhone = phoneMatch?.[0]?.trim();

  const addressMatch = bodyText.match(
    /\d{1,5}\s+\w+(\s\w+){1,4}\s+(Street|St|Avenue|Ave|Road|Rd|Blvd|Boulevard|Lane|Ln|Drive|Dr)\.?/i,
  );
  const address = addressMatch?.[0]?.trim();

  return {
    brandName,
    websiteUrl: baseUrl,
    metaTitle,
    metaDescription: metaDescription || heroText,
    accentColor: themeColor,
    logoUrl: logoImage || favicon || undefined,
    socialHandles: extractSocialHandles($, baseUrl, brandName),
    contactPhone,
    address,
    imageCandidates,
    imageAssets,
    selectedImages: selectedImages.length > 0 ? selectedImages : [screenshotFallback],
  };
}

function websiteScreenshotUrl(url: string): string {
  return `https://image.thum.io/get/width/1400/crop/800/noanimate/${encodeURIComponent(url)}`;
}

function canonicalImageKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.toLowerCase();
  } catch {
    return url.split("?")[0].toLowerCase();
  }
}

function getWidthHint(url: string): number {
  try {
    const parsed = new URL(url);
    return Number(parsed.searchParams.get("width") || parsed.searchParams.get("w") || 0);
  } catch {
    const match = url.match(/[?&](?:width|w)=(\d+)/i);
    return match ? Number(match[1]) : 0;
  }
}

function getHeightHint(url: string): number {
  try {
    const parsed = new URL(url);
    return Number(parsed.searchParams.get("height") || parsed.searchParams.get("h") || 0);
  } catch {
    const match = url.match(/[?&](?:height|h)=(\d+)/i);
    return match ? Number(match[1]) : 0;
  }
}

function extractImageUrlsFromText(html: string): string[] {
  const urls = new Set<string>();
  const patterns = [
    /https?:\\?\/\\?\/[^"'\\\s<>)]+?\.(?:avif|gif|jpe?g|png|webp)(?:\?[^"'\\\s<>)]+)?/gi,
    /\/\/[^"'\\\s<>)]+?\.(?:avif|gif|jpe?g|png|webp)(?:\?[^"'\\\s<>)]+)?/gi,
    /\/cdn\/shop\/files\/[^"'\\\s<>)]+/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      urls.add(match[0].replace(/\\\//g, "/").replace(/\\u0026/g, "&"));
    }
  }
  return Array.from(urls);
}

function extractJsonImageUrls(text: string): string[] {
  const urls = new Set<string>();
  try {
    const parsed = JSON.parse(text);
    walkJsonImages(parsed, urls);
  } catch {
    for (const url of extractImageUrlsFromText(text)) urls.add(url);
  }
  return Array.from(urls);
}

function walkJsonImages(value: unknown, urls: Set<string>) {
  if (!value) return;
  if (typeof value === "string") {
    if (isLikelyImage(value)) urls.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => walkJsonImages(item, urls));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      if (/image|logo|thumbnail|photo/i.test(key)) walkJsonImages(item, urls);
      else if (typeof item === "object") walkJsonImages(item, urls);
    });
  }
}

function normalizeColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const trimmed = color.trim();
  return /^#[0-9a-f]{3,8}$/i.test(trimmed) ? trimmed : undefined;
}

function inferAccent(baseUrl: string): string | undefined {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host.includes("bluorng") || host.includes("orange")) return "#f97316";
  } catch {
    return undefined;
  }
  return undefined;
}

function extractSocialHandles(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  brandName: string,
): BrandProfile["socialHandles"] {
  const fallback = `@${brandName.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  let instagram: string | undefined;
  let tiktok: string | undefined;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const full = abs(baseUrl, href) || href;
    const match = full.match(/(?:instagram\.com|tiktok\.com)\/@?([a-z0-9._-]+)/i);
    if (!match?.[1]) return;
    const handle = `@${match[1].replace(/\/$/, "")}`;
    if (/instagram\.com/i.test(full)) instagram = instagram ?? handle;
    if (/tiktok\.com/i.test(full)) tiktok = tiktok ?? handle;
  });

  if (baseUrl.includes("bluorng")) return { instagram: "@bluorng", tiktok: "@bluorng" };
  return {
    instagram: instagram ?? fallback,
    tiktok: tiktok ?? fallback,
  };
}
