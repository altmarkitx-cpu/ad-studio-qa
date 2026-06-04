// Server-only: fetch a website's HTML with timeout and a real UA.
import { detectBrandKind, fallbackDescriptionForKind } from "./brandSignals.server";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
];

export async function fetchSiteHtml(url: string): Promise<{ html: string; finalUrl: string }> {
  const attempts = buildUrlAttempts(url);
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return await fetchBrowserAttempt(attempt);
    } catch (error) {
      errors.push(`browser ${attempt}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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

  for (const attempt of attempts) {
    try {
      return await fetchProtectedBrowseAttempt(attempt);
    } catch (error) {
      errors.push(
        `protected ${attempt}: ${error instanceof Error ? error.message : String(error)}`,
      );
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
  const userAgent = pickUserAgent(url);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": userAgent,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Referer: new URL(url).origin,
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
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
    const userAgent = pickUserAgent(url);
    const readerUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
    const res = await fetch(readerUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/plain,text/markdown,*/*;q=0.8",
        "User-Agent": userAgent,
        "Accept-Language": "en-US,en;q=0.9",
        Referer: new URL(url).origin,
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

async function fetchBrowserAttempt(url: string): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);
  let browser: import("playwright").Browser | null = null;
  try {
    const userAgent = pickUserAgent(url);
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--disable-web-security",
      ],
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1200 },
      userAgent,
      locale: "en-US",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        Referer: new URL(url).origin,
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
      },
    });
    await applyStealthMask(page, userAgent);
    page.setDefaultTimeout(22000);
    page.setDefaultNavigationTimeout(32000);
    await page.goto(url, { waitUntil: "networkidle", timeout: 32000 });
    await deepRenderPage(page);

    const title = await page.title().catch(() => "");
    const html = await page.content();
    if (!/<html|<body|<main|<title|<meta/i.test(html)) {
      throw new Error("Browser response was not usable HTML");
    }
    if (isLikelyErrorPage(html)) {
      throw new Error("Browser returned a hosting/error page");
    }
    if (/captcha|cloudflare|access denied|verify you are human/i.test(`${title}\n${html.slice(0, 4000)}`)) {
      throw new Error("Browser hit a protection page");
    }
    return { html, finalUrl: page.url() || url };
  } finally {
    clearTimeout(timeout);
    await browser?.close().catch(() => {});
    controller.abort();
  }
}

async function fetchProtectedBrowseAttempt(url: string): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40000);
  let browser: import("playwright").Browser | null = null;
  try {
    const userAgent = pickUserAgent(url);
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--disable-web-security",
      ],
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1200 },
      userAgent,
      locale: "en-US",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        Referer: new URL(url).origin,
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
      },
    });
    await applyStealthMask(page, userAgent);
    page.setDefaultTimeout(22000);
    page.setDefaultNavigationTimeout(32000);
    await page.goto(url, { waitUntil: "networkidle", timeout: 32000 });
    await deepRenderPage(page);

    const title = await page.title().catch(() => "");
    const heading = await page.locator("h1").first().innerText({ timeoutMs: 1000 }).catch(() => "");
    const screenshot = await page.screenshot({ type: "png", fullPage: true });
    const screenshotDataUrl = `data:image/png;base64,${screenshot.toString("base64")}`;
    const heroText = cleanText(`${heading || title}` || brandNameFromUrl(url)).slice(0, 140);
    const html = `<!doctype html>
<html>
  <head>
    <title>${escapeHtml(title || heroText)}</title>
    <meta property="og:title" content="${escapeHtml(title || heroText)}" />
    <meta name="description" content="${escapeHtml(heroText)}" />
    <meta property="og:description" content="${escapeHtml(heroText)}" />
    <meta name="adstudio-screenshot" content="${escapeHtml(screenshotDataUrl)}" />
  </head>
  <body>
    <main>
      <h1>${escapeHtml(heading || title || brandNameFromUrl(url))}</h1>
      <p>${escapeHtml(heroText)}</p>
      <img src="${escapeHtml(screenshotDataUrl)}" alt="${escapeHtml(heading || title || "Site screenshot")}" />
    </main>
  </body>
</html>`;
    if (isLikelyErrorPage(html)) throw new Error("Protected fallback captured an error page");
    return { html, finalUrl: page.url() || url };
  } finally {
    clearTimeout(timeout);
    await browser?.close().catch(() => {});
    controller.abort();
  }
}

async function applyStealthMask(page: import("playwright").Page, userAgent: string) {
  await page.addInitScript(
    ({ ua }) => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
      Object.defineProperty(navigator, "platform", {
        get: () => (ua.includes("Macintosh") ? "MacIntel" : "Win32"),
      });
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });
      const chromeValue = {
        app: {},
        csi: () => undefined,
        loadTimes: () => undefined,
        runtime: {},
      };
      Object.defineProperty(window, "chrome", {
        get: () => chromeValue,
      });
      const originalQuery = window.navigator.permissions?.query;
      if (originalQuery) {
        window.navigator.permissions.query = (parameters) =>
          parameters.name === "notifications"
            ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
            : originalQuery.call(window.navigator.permissions, parameters);
      }
    },
    { ua: userAgent },
  );
}

async function deepRenderPage(page: import("playwright").Page) {
  await page.waitForLoadState("networkidle", { timeout: 9000 }).catch(() => {});
  await page.evaluate(async () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let lastHeight = 0;
    let stablePasses = 0;
    let y = 0;
    while (stablePasses < 4) {
      const maxHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
        window.innerHeight,
      );
      window.scrollTo(0, y);
      await wait(200);
      y += 500;
      if (y >= maxHeight) {
        window.scrollTo(0, maxHeight);
        await wait(700);
        const newHeight = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
          window.innerHeight,
        );
        stablePasses = newHeight === lastHeight ? stablePasses + 1 : 0;
        lastHeight = newHeight;
        y = Math.max(0, newHeight - window.innerHeight);
        if (newHeight <= window.innerHeight || stablePasses > 0) y = 0;
      }
    }
    window.scrollTo(0, document.body.scrollHeight);
    await wait(2000);
    window.scrollTo(0, 0);
    await wait(600);
  });
  await page.waitForLoadState("networkidle", { timeout: 9000 }).catch(() => {});
}

function pickUserAgent(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return USER_AGENTS[hash % USER_AGENTS.length] ?? USER_AGENTS[0];
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
