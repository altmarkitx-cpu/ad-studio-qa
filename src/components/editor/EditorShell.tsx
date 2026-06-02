import { Link } from "@tanstack/react-router";
import { useEditor, type EditorSection } from "@/store/editor-store";
import { PreviewCanvas } from "./PreviewCanvas";
import { SceneStrip } from "./SceneStrip";
import { Inspector } from "./Inspector";
import {
  Images,
  AlignEndHorizontal,
  Square,
  QrCode,
  Music,
  Mic,
  Settings,
  RefreshCw,
  Check,
  Plus,
  X,
} from "lucide-react";
import { useState } from "react";

const NAV: {
  id: EditorSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "slideshow", label: "Scenes", icon: Images },
  { id: "banner", label: "Bottom Banner", icon: AlignEndHorizontal },
  { id: "endcard", label: "End Screen", icon: Square },
  { id: "qr", label: "QR Code", icon: QrCode },
  { id: "music", label: "Music", icon: Music },
  { id: "voice", label: "Voice & Script", icon: Mic },
  { id: "ai", label: "More Ads", icon: Settings },
];

export function EditorShell({ onRegenerate }: { onRegenerate: () => Promise<unknown> }) {
  const project = useEditor((s) => s.project)!;
  const section = useEditor((s) => s.section);
  const setSection = useEditor((s) => s.setSection);
  const dirty = useEditor((s) => s.dirty);
  const variants = useEditor((s) => s.variants);
  const activeVariantId = useEditor((s) => s.activeVariantId);
  const selectVariant = useEditor((s) => s.selectVariant);
  const createVariant = useEditor((s) => s.createVariant);
  const removeVariant = useEditor((s) => s.removeVariant);
  const [regenLoading, setRegenLoading] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-accent/30">
      {/* Header */}
      <header className="h-14 border-b border-border px-4 flex items-center justify-between shrink-0 bg-panel/50 backdrop-blur-md">
        <div className="flex items-center gap-6">
          <Link
            to="/"
            className="font-display text-lg tracking-tighter text-white flex items-center gap-2"
          >
            <div className="size-5 bg-accent rounded-sm shadow-[0_0_15px_rgba(99,102,241,0.5)]" />
            AD STUDIO
          </Link>
          <div className="hidden md:flex items-center bg-black/40 border border-border rounded-full pl-4 pr-1 py-1 gap-3 w-96">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
              Source
            </span>
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
          {variants.length > 0 && (
            <div className="hidden xl:flex max-w-[420px] items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-black/35 p-1">
              {variants.map((variant) => {
                const active = variant.id === activeVariantId;
                return (
                  <button
                    key={variant.id}
                    onClick={() => selectVariant(variant.id)}
                    className={`h-7 shrink-0 rounded-full px-3 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                      active
                        ? "bg-accent text-white shadow-lg shadow-accent/20"
                        : "text-muted-foreground hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {variant.label}
                  </button>
                );
              })}
              <button
                onClick={() => createVariant()}
                title="Generate new ad variant"
                className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-white"
              >
                <Plus className="size-3.5" />
              </button>
              {variants.length > 1 && activeVariantId && (
                <button
                  onClick={() => removeVariant(activeVariantId)}
                  title="Remove current ad variant"
                  className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )}
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
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Left nav */}
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

        {/* Center: preview + scene strip */}
        <div className="flex-1 flex flex-col bg-[#050506] relative min-w-0">
          <div className="flex-1 flex items-center justify-center p-8 md:p-12 min-h-0">
            <PreviewCanvas />
          </div>
          <SceneStrip />
        </div>

        {/* Right inspector */}
        <aside className="w-80 border-l border-border bg-panel flex flex-col shrink-0 overflow-y-auto">
          <Inspector />
        </aside>
      </main>
    </div>
  );
}
