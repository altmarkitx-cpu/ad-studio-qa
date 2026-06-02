import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/image")({
  server: {
    handlers: {
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
            },
          });
          if (!response.ok) return imageError(`Image responded ${response.status}`, 502);

          const contentType = response.headers.get("content-type") || "image/jpeg";
          if (!contentType.startsWith("image/")) return imageError("URL was not an image", 415);

          return new Response(response.body, {
            headers: {
              "Content-Type": contentType,
              "Cache-Control": "public, max-age=86400",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, OPTIONS",
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

function imageError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
