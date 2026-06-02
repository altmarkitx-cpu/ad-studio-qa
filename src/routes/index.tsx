import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { createGenerationJob } from "@/lib/ad.functions";
import { ArrowRight, Loader2, Sparkles, Globe, Wand2, Film } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AD STUDIO - Turn any website into a TV-quality spot" },
      {
        name: "description",
        content:
          "Paste a website URL. AI extracts brand, images, and copy, then builds an editable spot in seconds.",
      },
      { property: "og:title", content: "AD STUDIO" },
      {
        property: "og:description",
        content: "From URL to ready-to-edit spot in seconds.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const createJob = useServerFn(createGenerationJob);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    let normalized = url.trim();
    if (!/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;
    try {
      new URL(normalized);
    } catch {
      setErr("Please enter a valid website URL");
      return;
    }
    setBusy(true);
    try {
      const result = await createJob({ data: { url: normalized } });
      if (!result || !result.jobId) {
        throw new Error("Generation did not return a job id");
      }
      const { jobId, projectId, project } = result;
      if (projectId) {
        try {
          sessionStorage.setItem(
            `ad-studio-job-${jobId}`,
            JSON.stringify({ projectId, sourceUrl: normalized }),
          );
          if (project) {
            sessionStorage.setItem(`ad-studio-project-${projectId}`, JSON.stringify(project));
          }
        } catch {
          // Large image-heavy projects can exceed browser storage; the server record remains primary.
        }
      }
      await navigate({ to: "/generate/$jobId", params: { jobId } });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to start generation");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2 font-display tracking-tight text-lg">
          <div className="size-5 bg-accent rounded-sm shadow-[0_0_20px_rgba(99,102,241,0.6)]" />
          AD STUDIO
        </div>
        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          Production render studio
        </span>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="max-w-2xl w-full text-center animate-slide-up">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-[10px] font-bold uppercase tracking-widest text-accent mb-6">
            <Sparkles className="size-3" />
            From URL to ready-to-edit spot
          </div>
          <h1 className="font-display text-5xl md:text-6xl tracking-tighter leading-[0.95] text-white mb-4">
            Turn any website
            <br />
            into a cinematic spot.
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto mb-10">
            Paste a business URL. We pull the brand, images, and tone, then write the script, build
            cinematic scenes, and open the editor.
          </p>

          <form
            onSubmit={submit}
            className="flex items-center bg-panel border border-border rounded-full pl-5 pr-1.5 py-1.5 gap-3 max-w-xl mx-auto focus-within:border-accent/50 transition-colors"
          >
            <Globe className="size-4 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-business.com"
              disabled={busy}
              className="bg-transparent flex-1 outline-none text-sm placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={busy || !url}
              className="h-9 px-4 bg-accent text-white text-xs font-bold rounded-full hover:brightness-110 transition-all shadow-lg shadow-accent/30 uppercase tracking-widest flex items-center gap-2 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <>
                  Generate <ArrowRight className="size-3" />
                </>
              )}
            </button>
          </form>
          {err && <p className="text-destructive text-xs mt-3">{err}</p>}

          <div className="grid grid-cols-3 gap-6 mt-16 text-left">
            <Feature
              icon={<Globe className="size-4" />}
              title="Extract"
              text="We fetch the site and pull brand, images, contact info, and tone."
            />
            <Feature
              icon={<Wand2 className="size-4" />}
              title="Generate"
              text="The creative engine writes the voiceover, headline, CTA, and end card."
            />
            <Feature
              icon={<Film className="size-4" />}
              title="Edit"
              text="Open the editor to fine-tune scenes, music, voice, QR, and more."
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="p-4 rounded-xl bg-panel/40 border border-border">
      <div className="size-8 rounded-md bg-accent/10 text-accent grid place-items-center mb-3">
        {icon}
      </div>
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>
    </div>
  );
}
