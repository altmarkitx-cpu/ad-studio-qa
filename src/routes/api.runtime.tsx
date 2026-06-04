import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/runtime")({
  server: {
    handlers: {
      GET: async () => {
        const nodeMajor = Number(process.version.match(/^v(\d+)/)?.[1] ?? 0);
        return Response.json({
          ok: nodeMajor >= 22,
          nodeVersion: process.version,
          nodeMajor,
          node22: nodeMajor >= 22,
          nodeEnv: process.env.NODE_ENV ?? null,
          supabaseConfigured: Boolean(
            process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
          ),
          geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
          railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME ?? null,
          expectedBuilder: "dockerfile",
          expectedStartCommand: "npm start",
          checkedAt: new Date().toISOString(),
        });
      },
    },
  },
});
