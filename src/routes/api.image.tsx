import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/image")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          headers: proxyHeaders(),
        }),
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const rawUrl = requestUrl.searchParams.get("url");
        if (!rawUrl) return imageError("Missing image URL", 400);

        let target: URL;
        try {
          target = new URL(rawUrl);
          if (!["http:", "https:"].includes(target.protocol)) {
            return imageError("Unsupported image URL", 400);
          }
        } catch {
          return imageError("Invalid image URL", 400);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
          const response = await fetch(target.toString(), {
            redirect: "follow",
            signal: controller.signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
              Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
              Referer: target.origin,
              "Sec-Fetch-Dest": "image",
              "Sec-Fetch-Mode": "no-cors",
              "Sec-Fetch-Site": "cross-site",
            },
          });
          if (!response.ok) return imageError(`Image responded ${response.status}`, 502);

          const contentType = response.headers.get("content-type") || "image/jpeg";
          if (!contentType.startsWith("image/")) return imageError("URL was not an image", 415);
          const contentLength = Number(response.headers.get("content-length") || 0);
          if (contentLength > 10_000_000) return imageError("Image is too large", 413);
          if (contentLength > 0 && contentLength < 5_000) {
            return imageError("Image is too small for a scene", 422);
          }

          return new Response(response.body, {
            headers: {
              ...proxyHeaders(),
              "Content-Type": contentType,
              "Cache-Control": "public, max-age=86400",
              "Content-Disposition": "inline",
            },
          });
        } catch (error) {
          return imageError(error instanceof Error ? error.message : "Image fetch failed", 502);
        } finally {
          clearTimeout(timeout);
        }
      },
    },
  },
});

function proxyHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    Vary: "Origin",
  };
}

function imageError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      ...proxyHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
