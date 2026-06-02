import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/audio")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const rawUrl = requestUrl.searchParams.get("url");
        if (!rawUrl) return audioError("Missing audio URL", 400);

        let target: URL;
        try {
          target = new URL(rawUrl);
          if (!["http:", "https:"].includes(target.protocol)) {
            return audioError("Unsupported audio URL", 400);
          }
        } catch {
          return audioError("Invalid audio URL", 400);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
          const response = await fetch(target.toString(), {
            redirect: "follow",
            signal: controller.signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
              Accept: "audio/mpeg,audio/wav,audio/ogg,audio/*,*/*;q=0.8",
              Referer: target.origin,
            },
          });
          if (!response.ok) return audioError(`Audio responded ${response.status}`, 502);

          const contentType = response.headers.get("content-type") || "audio/mpeg";
          if (!contentType.startsWith("audio/") && contentType !== "application/octet-stream") {
            return audioError("URL was not an audio file", 415);
          }

          return new Response(response.body, {
            headers: {
              "Content-Type":
                contentType === "application/octet-stream" ? "audio/mpeg" : contentType,
              "Cache-Control": "public, max-age=86400",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, OPTIONS",
            },
          });
        } catch (error) {
          return audioError(error instanceof Error ? error.message : "Audio fetch failed", 502);
        } finally {
          clearTimeout(timeout);
        }
      },
    },
  },
});

function audioError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
