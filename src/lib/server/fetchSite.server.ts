// Server-only: fetch a website's HTML with timeout and a real UA.
import { detectBrandKind, fallbackDescriptionForKind } from "./brandSignals.server";

export async function fetchSiteHtml(url: string): Promise<{ html: string; finalUrl: string }> {
  const attempts = buildUrlAttempts(url);
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return await fetchHtmlAttempt(attempt);
    } catch (error) {
      errors.push(`${attempt}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const attempt of attempts) {
    try {
      return await fetchReaderAttempt(attempt);
    } catch (error) {
      errors.push(`reader ${attempt}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.warn("[fetchSiteHtml] using synthetic fallback", errors.slice(0, 4));
  return {
    html: syntheticBusinessHtml(url),
    finalUrl: url,
  };
}

async function fetchHtmlAttempt(url: string): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });
    if (!res.ok) throw new Error(`Site responded ${res.status}`);
    const html = await res.text();
    if (!/<html|<body|<main|<title|<meta/i.test(html)) {
      throw new Error("Site response was not usable HTML");
    }
    if (isLikelyErrorPage(html)) {
      throw new Error("Site returned a hosting/error page");
    }
    return { html, finalUrl: res.url || url };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchReaderAttempt(url: string): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const readerUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
    const res = await fetch(readerUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/plain,text/markdown,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
    if (!res.ok) throw new Error(`Reader responded ${res.status}`);
    const text = await res.text();
    if (text.trim().length < 40) throw new Error("Reader response was too short");
    if (isLikelyErrorPage(text)) throw new Error("Reader returned a hosting/error page");
    return { html: readerTextToHtml(text, url), finalUrl: url };
  } finally {
    clearTimeout(timeout);
  }
}

function buildUrlAttempts(input: string): string[] {
  const out = new Set<string>();
  out.add(input);
  try {
    const parsed = new URL(input);
    if (!parsed.hostname.startsWith("www.")) {
      const withWww = new URL(parsed);
      withWww.hostname = `www.${parsed.hostname}`;
      out.add(withWww.toString());
    }
    if (parsed.protocol === "https:") {
      const http = new URL(parsed);
      http.protocol = "http:";
      out.add(http.toString());
    }
  } catch {
    // The caller validates URLs before this point, but keep the fetcher defensive.
  }
  return Array.from(out);
}

function isLikelyErrorPage(html: string): boolean {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
  return /\b(404\s*:?\s*not found|deployment not found|page not found|site not found|domain not configured)\b/i.test(
    text,
  );
}

function readerTextToHtml(text: string, url: string): string {
  const title =
    text.match(/^Title:\s*(.+)$/im)?.[1]?.trim() ||
    text.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    brandNameFromUrl(url);
  const markdown =
    text.split(/Markdown Content:\s*/i)[1]?.trim() ||
    text
      .replace(/^Title:.*$/gim, "")
      .replace(/^URL Source:.*$/gim, "")
      .trim();
  const description = cleanText(markdown).slice(0, 260);
  return `<!doctype html>
<html>
  <head>
    <title>${escapeHtml(title)}</title>
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(websiteScreenshotUrl(url))}" />
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
      <img src="${escapeHtml(websiteScreenshotUrl(url))}" alt="${escapeHtml(title)}" />
      <article>${markdownToParagraphs(markdown)}</article>
    </main>
  </body>
</html>`;
}

function syntheticBusinessHtml(url: string): string {
  const brandName = brandNameFromUrl(url);
  const description = descriptionFromUrl(url, brandName);
  return `<!doctype html>
<html>
  <head>
    <title>${escapeHtml(brandName)}</title>
    <meta property="og:title" content="${escapeHtml(brandName)}" />
    <meta property="og:site_name" content="${escapeHtml(brandName)}" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${escapeHtml(websiteScreenshotUrl(url))}" />
  </head>
  <body>
    <main>
      <h1>${escapeHtml(brandName)}</h1>
      <p>${escapeHtml(description)}</p>
      <img src="${escapeHtml(websiteScreenshotUrl(url))}" alt="${escapeHtml(brandName)}" />
    </main>
  </body>
</html>`;
}

function descriptionFromUrl(url: string, brandName: string): string {
  return fallbackDescriptionForKind(detectBrandKind(`${url} ${brandName}`), brandName);
}

function brandNameFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const first = host.split(".")[0] || "Brand";
    if (first.length <= 4) return first.toUpperCase();
    return first
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "Local Business";
  }
}

function websiteScreenshotUrl(url: string): string {
  return `https://image.thum.io/get/width/1400/crop/800/noanimate/${encodeURIComponent(url)}`;
}

function markdownToParagraphs(markdown: string): string {
  return cleanText(markdown)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("\n");
}

function cleanText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_`>~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
