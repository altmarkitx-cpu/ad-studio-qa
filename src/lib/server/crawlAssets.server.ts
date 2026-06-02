import * as cheerio from "cheerio";
import type { BrandProfile } from "../types";
import { extractFromHtml } from "./extract.server";

const MAX_PAGES = 5;

export async function crawlAdditionalBrandAssets(args: {
  html: string;
  baseUrl: string;
  brand: BrandProfile;
}): Promise<BrandProfile> {
  const urls = pickInternalAssetPages(args.html, args.baseUrl);
  if (urls.length === 0) return args.brand;

  const pages = await Promise.all(urls.map((url) => fetchCrawlPage(url)));
  const brands = pages
    .map((page) => (page ? extractFromHtml(page.html, page.finalUrl) : null))
    .filter((brand): brand is BrandProfile => Boolean(brand));

  if (brands.length === 0) return args.brand;

  return {
    ...args.brand,
    metaDescription:
      args.brand.metaDescription ||
      brands.find((brand) => brand.metaDescription)?.metaDescription ||
      args.brand.metaDescription,
    logoUrl: args.brand.logoUrl || brands.find((brand) => brand.logoUrl)?.logoUrl,
    imageCandidates: mergeImages(
      args.brand.imageCandidates,
      brands.flatMap((brand) => brand.imageCandidates),
    ),
    selectedImages: mergeImages(
      args.brand.selectedImages,
      brands.flatMap((brand) => brand.selectedImages),
    ).slice(0, 120),
  };
}

function pickInternalAssetPages(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const scored = new Map<string, number>();

  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href");
    if (!raw) return;
    let url: URL;
    try {
      url = new URL(raw, baseUrl);
    } catch {
      return;
    }
    if (url.origin !== base.origin) return;
    if (!["http:", "https:"].includes(url.protocol)) return;
    url.hash = "";
    const href = url.toString();
    if (shouldSkipLink(url)) return;
    const score = scoreAssetPage(url, $(el).text());
    if (score <= 0) return;
    scored.set(href, Math.max(scored.get(href) ?? 0, score));
  });

  return Array.from(scored.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PAGES)
    .map(([url]) => url);
}

function shouldSkipLink(url: URL): boolean {
  const path = `${url.pathname} ${url.search}`.toLowerCase();
  return /\/(cart|checkout|account|login|register|wishlist|privacy|terms|policy|contact|blog|news)(\/|$)/.test(
    path,
  );
}

function scoreAssetPage(url: URL, text: string): number {
  const haystack = `${url.pathname} ${url.search} ${text}`.toLowerCase();
  let score = 0;
  if (
    /(shop|store|collection|collections|product|products|category|catalog|menu|inventory)/.test(
      haystack,
    )
  ) {
    score += 80;
  }
  if (/(new|arrival|drop|featured|lookbook|gallery|work|portfolio|services)/.test(haystack)) {
    score += 35;
  }
  if (/(sale|offer|special|vehicle|cars|fashion|food|grocery|market)/.test(haystack)) {
    score += 20;
  }
  if (url.pathname === "/" || url.pathname.length <= 1) score -= 100;
  return score;
}

async function fetchCrawlPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!response.ok) return null;
    const html = await response.text();
    if (!/<html|<body|<main|<title|<meta/i.test(html)) return null;
    return { html, finalUrl: response.url || url };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function mergeImages(primary: string[], secondary: string[]): string[] {
  return Array.from(new Set([...primary, ...secondary].filter(Boolean)));
}
