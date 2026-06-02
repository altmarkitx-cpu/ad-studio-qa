// Server-only: parse HTML and build a BrandProfile.
import * as cheerio from "cheerio";
import type { BrandProfile } from "../types";

function abs(base: string, href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function addImage(
  images: { url: string; score: number }[],
  baseUrl: string,
  rawUrl: string | undefined,
  score: number,
) {
  const url = abs(baseUrl, cleanImageUrl(rawUrl));
  if (!url || !isLikelyImage(url)) return;
  images.push({ url, score });
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

function parseSrcset(srcset: string | undefined): string[] {
  if (!srcset) return [];
  return srcset
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function extractCssUrls(value: string | undefined): string[] {
  if (!value) return [];
  return Array.from(value.matchAll(/url\(([^)]+)\)/gi), (match) => match[1]);
}

function scoreImage(src: string, alt: string, w?: number, h?: number): number {
  let score = 0;
  if (w && h) score += Math.min((w * h) / 10000, 50);
  if (w && w >= 600) score += 20;
  if (alt && alt.length > 4) score += 10;
  const lower = src.toLowerCase();
  if (/(hero|banner|cover|product|feature|lifestyle)/.test(lower)) score += 25;
  if (/(logo|icon|sprite|favicon|avatar|pixel|tracking|placeholder)/.test(lower)) score -= 40;
  if (/\.svg($|\?)/.test(lower)) score -= 15;
  if (/(\.gif)($|\?)/.test(lower)) score -= 10;
  return score;
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
  const imageScores: { url: string; score: number }[] = [];
  $("img").each((_, el) => {
    const src = abs(
      baseUrl,
      cleanImageUrl(
        $(el).attr("src") ||
          $(el).attr("data-src") ||
          $(el).attr("data-original") ||
          $(el).attr("data-lazy-src") ||
          $(el).attr("data-master"),
      ),
    );
    if (!src) return;
    const alt = $(el).attr("alt") || "";
    const w = parseInt($(el).attr("width") || "0", 10) || undefined;
    const h = parseInt($(el).attr("height") || "0", 10) || undefined;
    imageScores.push({ url: src, score: scoreImage(src, alt, w, h) });
    for (const srcsetUrl of parseSrcset($(el).attr("srcset") || $(el).attr("data-srcset"))) {
      addImage(imageScores, baseUrl, srcsetUrl, scoreImage(srcsetUrl, alt, w, h) + 5);
    }
  });

  $("source").each((_, el) => {
    for (const srcsetUrl of parseSrcset($(el).attr("srcset") || $(el).attr("data-srcset"))) {
      addImage(
        imageScores,
        baseUrl,
        srcsetUrl,
        scoreImage(srcsetUrl, "", undefined, undefined) + 5,
      );
    }
  });

  $(
    'link[rel="preload"][as="image"], link[rel="image_src"], link[rel="preload"][type^="image/"]',
  ).each((_, el) => {
    addImage(imageScores, baseUrl, $(el).attr("href"), 60);
    for (const srcsetUrl of parseSrcset($(el).attr("imagesrcset"))) {
      addImage(imageScores, baseUrl, srcsetUrl, 65);
    }
  });

  $("[style]").each((_, el) => {
    for (const cssUrl of extractCssUrls($(el).attr("style"))) {
      addImage(imageScores, baseUrl, cssUrl, 30);
    }
  });

  $("style").each((_, el) => {
    for (const cssUrl of extractCssUrls($(el).text())) {
      addImage(imageScores, baseUrl, cssUrl, 28);
    }
  });

  $("[data-bg], [data-background], [data-image], [data-image-url]").each((_, el) => {
    addImage(imageScores, baseUrl, $(el).attr("data-bg"), 35);
    addImage(imageScores, baseUrl, $(el).attr("data-background"), 35);
    addImage(imageScores, baseUrl, $(el).attr("data-image"), 35);
    addImage(imageScores, baseUrl, $(el).attr("data-image-url"), 35);
  });

  $('script[type="application/ld+json"]').each((_, el) => {
    for (const url of extractJsonImageUrls($(el).text())) {
      addImage(imageScores, baseUrl, url, 74);
    }
  });
  if (ogImage) imageScores.push({ url: ogImage, score: 100 });
  if (twitterImage) imageScores.push({ url: twitterImage, score: 96 });
  if (itempropImage) imageScores.push({ url: itempropImage, score: 94 });
  imageScores.push({ url: screenshotFallback, score: 92 });

  for (const url of extractImageUrlsFromText(html)) {
    addImage(imageScores, baseUrl, url, scoreImage(url, "", undefined, undefined) + 12);
  }

  // Dedupe + sort. Shopify often repeats the same image at many widths.
  const bestByImage = new Map<string, { url: string; score: number }>();
  for (const image of imageScores) {
    if (image.score <= -10) continue;
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

  const imageCandidates = sorted.map((s) => s.url);
  const selectedImages = sorted.map((s) => s.url).slice(0, 80);

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

function extractImageUrlsFromText(html: string): string[] {
  const urls = new Set<string>();
  const patterns = [
    /https?:\\?\/\\?\/[^"'\\\s<>)]+?\.(?:avif|gif|jpe?g|png|webp)(?:\?[^"'\\\s<>)]+)?/gi,
    /\/\/[^"'\\\s<>)]+?\.(?:avif|gif|jpe?g|png|webp)(?:\?[^"'\\\s<>)]+)?/gi,
    /\/cdn\/shop\/files\/[^"'\\\s<>)]+/gi,
    /https?:\\?\/\\?\/[^"'\\\s<>)]+?(?:cdn-images|image\.|images\.|assets\.|media\.|static\.)[^"'\\\s<>)]+/gi,
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
