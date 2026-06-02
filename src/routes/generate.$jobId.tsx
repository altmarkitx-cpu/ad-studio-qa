import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getJob } from "@/lib/ad.functions";
import { AlertTriangle, ArrowRight, Check, Film, Loader2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/generate/$jobId")({
  component: GeneratePage,
});

function GeneratePage() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();
  const get = useServerFn(getJob);
  const [handoff, setHandoff] = useState<{ projectId?: string; sourceUrl?: string } | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`ad-studio-job-${jobId}`);
      setHandoff(raw ? (JSON.parse(raw) as { projectId?: string; sourceUrl?: string }) : null);
    } catch {
      setHandoff(null);
    }
  }, [jobId]);

  const q = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => get({ data: { id: jobId } }),
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 800;
      return d.status === "done" || d.status === "failed" ? false : 800;
    },
  });

  const logs = q.data?.stepLogs ?? [];
  const steps = ["Fetching site", "Extracting assets", "Generating copy", "Building creative"];
  const doneCount = steps.filter((step) => {
    const log = [...logs].reverse().find((item) => item.step === step);
    return log?.status === "done";
  }).length;
  const progress =
    q.data?.status === "done" || handoff?.projectId
      ? 100
      : Math.round((doneCount / steps.length) * 100);
  const assetDetail = [...logs]
    .reverse()
    .find((log) => log.step === "Extracting assets" && log.detail)?.detail;
  const recoveryDetail = [...logs]
    .reverse()
    .find((log) => /Recovered/i.test(log.detail ?? ""))?.detail;
  const readyProjectId = q.data?.projectId ?? handoff?.projectId;
  const ready = Boolean((q.data?.status === "done" && q.data.projectId) || handoff?.projectId);
  const sourceUrl = q.data?.sourceUrl ?? handoff?.sourceUrl ?? "...";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-6">
      <div className="max-w-xl w-full">
        <div className="mb-8">
          <p className="text-[10px] font-bold uppercase tracking-widest text-accent mb-3">
            {ready ? "Your ad is ready" : "Building your ad"}
          </p>
          <h1 className="font-display text-3xl tracking-tight mb-1 text-white truncate">
            {sourceUrl}
          </h1>
          <p className="text-xs font-mono text-muted-foreground">job: {jobId.slice(0, 8)}</p>
        </div>

        {ready && (
          <div className="mb-5 overflow-hidden rounded-2xl border border-accent/30 bg-accent/10 p-5 shadow-2xl shadow-accent/10">
            <div className="mb-4 flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-white shadow-lg shadow-accent/30">
                <Film className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-2xl tracking-tight text-white">
                  Your editable spot is ready.
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Review the video, swap images, tune the script, choose music, and render all
                  formats from the editor.
                </p>
              </div>
            </div>
            <div className="mb-4 grid gap-2 sm:grid-cols-3">
              <ReadyChip label="Scenes" value="4+" />
              <ReadyChip label="Formats" value="16:9 / 9:16 / 1:1" />
              <ReadyChip label="Export" value="Queue ready" />
            </div>
            <button
              onClick={() =>
                readyProjectId &&
                void navigate({
                  to: "/editor/$projectId",
                  params: { projectId: readyProjectId },
                })
              }
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white px-5 text-xs font-black uppercase tracking-widest text-black transition-transform hover:scale-[1.02]"
            >
              Open editor <ArrowRight className="size-4" />
            </button>
          </div>
        )}

        <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        <ol className="space-y-3">
          {steps.map((s) => {
            const log = [...logs].reverse().find((l) => l.step === s);
            const status = log?.status ?? "pending";
            return (
              <li
                key={s}
                className="flex items-center gap-3 p-3 rounded-lg border border-border bg-panel/40"
              >
                <div className="size-5 grid place-items-center shrink-0">
                  {status === "done" ? (
                    <Check className="size-4 text-accent" />
                  ) : status === "running" ? (
                    <Loader2 className="size-4 text-accent animate-spin" />
                  ) : status === "failed" ? (
                    <AlertTriangle className="size-4 text-destructive" />
                  ) : (
                    <div className="size-2 rounded-full bg-muted-foreground/30" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{s}</p>
                  {log?.detail && (
                    <p className="text-[10px] font-mono text-muted-foreground truncate">
                      {log.detail}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {(assetDetail || recoveryDetail) && (
          <div className="mt-5 rounded-xl border border-white/10 bg-panel/40 p-4">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-accent">
              <Sparkles className="size-3" />
              Creative summary
            </div>
            {assetDetail && <p className="text-xs text-muted-foreground">{assetDetail}</p>}
            {recoveryDetail && (
              <p className="mt-1 text-xs text-amber-300/85">
                Site-safe fallback used: {recoveryDetail}
              </p>
            )}
          </div>
        )}

        {q.isError && handoff?.projectId && (
          <div className="mt-5 rounded-xl border border-amber-400/25 bg-amber-400/10 p-4 text-xs text-amber-100">
            Worker memory did not return the job record, but the generated project handoff is
            available. Open the editor to continue.
          </div>
        )}

        {q.data?.status === "failed" && !handoff?.projectId && (
          <div className="mt-6 p-4 rounded-lg border border-destructive/30 bg-destructive/5 text-sm">
            <p className="font-semibold text-destructive mb-1">Generation failed</p>
            <p className="text-xs text-muted-foreground">{q.data.error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ReadyChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xs font-semibold text-white">{value}</p>
    </div>
  );
}
