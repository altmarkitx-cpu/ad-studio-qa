import { Link } from "@tanstack/react-router";
import { useEditor, type EditorSection } from "@/store/editor-store";
import { PreviewCanvas } from "./PreviewCanvas";
import { SceneStrip } from "./SceneStrip";
import { Inspector } from "./Inspector";
import { ProjectTimeline } from "./ProjectTimeline";
import { VariantGallery } from "./VariantGallery";
import {
  Images,
  AlignEndHorizontal,
  Square,
  QrCode,
  Music,
  Mic,
  Settings,
  Download,
  Check,
} from "lucide-react";
import { useState } from "react";

const NAV: { id: EditorSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "slideshow", label: "Slideshow", icon: Images },
  { id: "banner", label: "Bottom Banner", icon: AlignEndHorizontal },
  { id: "endcard", label: "End Screen", icon: Square },
  { id: "qr", label: "QR Code", icon: QrCode },
  { id: "music", label: "Music", icon: Music },
  { id: "voice", label: "Voice & Script", icon: Mic },
  { id: "ai", label: "AI Input Settings", icon: Settings },
];

export function EditorShell({ onRegenerate }: { onRegenerate: () => Promise<unknown> }) {
  const project = useEditor((s) => s.project)!;
  const section = useEditor((s) => s.section);
  const setSection = useEditor((s) => s.setSection);
  const dirty = useEditor((s) => s.dirty);
  const [regenLoading, setRegenLoading] = useState(false);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.brand.brandName}-ad.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-accent/30">
      <header className="h-14 border-b border-border px-4 flex items-center justify-between shrink-0 bg-panel/50 backdrop-blur-md">
        <div className="flex items-center gap-6">
          <Link to="/" className="font-display text-lg tracking-tighter text-white flex items-center gap-2">
            <div className="size-5 bg-accent rounded-sm shadow-[0_0_15px_rgba(99,102,241,0.5)]" />
            ADSTUDIO
          </Link>
          <div className="hidden md:flex items-center bg-black/40 border border-border rounded-full pl-4 pr-1 py-1 gap-3 w-96">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Source</span>
            <input
              type="text"
              value={project.sourceUrl}
              readOnly
              className="bg-transparent text-xs w-full outline-none text-muted-foreground truncate"
            />
            <button
              onClick={async () => {
                setRegenLoading(true);
                try {
                  await onRegenerate();
                  window.location.reload();
                } finally {
                  setRegenLoading(false);
                }
              }}
              disabled={regenLoading}
              className="px-3 py-1 bg-white/5 hover:bg-white/10 rounded-full text-[10px] font-bold tracking-wider transition-colors disabled:opacity-50"
            >
              {regenLoading ? "…" : "REGENERATE"}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1.5">
            {dirty ? (
              <>
                <span className="size-1.5 rounded-full bg-amber-400 animate-pulse-dot" />
                Saving…
              </>
            ) : (
              <>
                <Check className="size-3 text-accent" /> Saved
              </>
            )}
          </span>
          <button
            onClick={handleExport}
            className="h-8 px-4 bg-accent text-white text-[11px] font-bold rounded-md hover:brightness-110 transition-all shadow-lg shadow-accent/20 uppercase tracking-widest flex items-center gap-1.5"
          >
            <Download className="size-3" /> Export
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <nav className="w-16 border-r border-border flex flex-col items-center py-4 gap-2 shrink-0">
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = section === n.id;
            return (
              <button
                key={n.id}
                onClick={() => setSection(n.id)}
                title={n.label}
                className={`size-10 rounded-lg grid place-items-center transition-colors ${
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
              >
                <Icon className="size-4" />
              </button>
            );
          })}
        </nav>

        <div className="flex-1 flex flex-col bg-[#050506] relative min-w-0 overflow-hidden">
          <VariantGallery />
          <div className="shrink-0 flex justify-center px-6 pb-4 pt-5 md:px-10 md:pb-5 md:pt-6">
            <PreviewCanvas />
          </div>
          <ProjectTimeline />
          <SceneStrip />
        </div>

        <aside className="w-80 border-l border-border bg-panel flex flex-col shrink-0 overflow-y-auto">
          <Inspector />
        </aside>
      </main>
    </div>
  );
}
