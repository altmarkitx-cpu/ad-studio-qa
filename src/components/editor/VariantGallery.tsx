import { useState } from "react";
import { useEditor } from "@/store/editor-store";
import type { AdVariantData } from "@/lib/types";
import { Plus, Sparkles, Wand2, X, Loader2 } from "lucide-react";

export function VariantGallery() {
  const project = useEditor((s) => s.project)!;
  const activeVariantId = useEditor((s) => s.activeVariantId);
  const variants = useEditor((s) => s.variants);
  const selectVariant = useEditor((s) => s.selectVariant);
  const createVariant = useEditor((s) => s.createVariant);
  const removeVariant = useEditor((s) => s.removeVariant);

  const [loading, setLoading] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [prompt, setPrompt] = useState("");

  const generate = async (customPrompt?: string) => {
    setLoading(true);
    try {
      createVariant(customPrompt);
      setPrompt("");
      setShowCustom(false);
    } catch (e) {
      console.error("[variant create]", e);
    } finally {
      setLoading(false);
    }
  };

  const onDelete = (v: AdVariantData, e: React.MouseEvent) => {
    e.stopPropagation();
    removeVariant(v.id);
  };

  return (
    <div className="border-b border-border bg-panel/40 px-4 py-2 flex items-center gap-2 overflow-x-auto">
      <span className="font-mono text-[9px] text-muted-foreground tracking-widest uppercase shrink-0">
        Variants
      </span>

      {variants.map((v, i) => (
        <Tab
          key={v.id}
          active={activeVariantId === v.id}
          label={v.label || `Ad ${i + 1}`}
          sub={v.prompt ? "custom" : "system"}
          onClick={() => selectVariant(v.id)}
          onDelete={variants.length > 1 ? (e) => onDelete(v, e) : undefined}
        />
      ))}

      <button
        onClick={() => generate()}
        disabled={loading}
        className="h-8 px-3 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] flex items-center gap-1.5 transition-colors disabled:opacity-50 shrink-0"
        title="Generate new system ad"
      >
        {loading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
        New system ad
      </button>
      <button
        onClick={() => setShowCustom((v) => !v)}
        className="h-8 px-3 rounded-md bg-accent/15 hover:bg-accent/25 border border-accent/30 text-accent text-[11px] flex items-center gap-1.5 transition-colors shrink-0"
      >
        <Wand2 className="size-3" /> Custom prompt
      </button>

      {showCustom && (
        <div className="absolute right-4 top-32 z-40 w-96 bg-panel border border-border rounded-lg p-3 shadow-2xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Custom variant prompt
            </span>
            <button onClick={() => setShowCustom(false)}>
              <X className="size-3 text-muted-foreground" />
            </button>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. promote the new luxury weekend collection arriving Saturday"
            className="w-full bg-black/40 border border-white/10 rounded-md p-2 text-xs min-h-[80px] resize-none outline-none focus:border-accent/40"
          />
          <button
            onClick={() => prompt.trim() && generate(prompt.trim())}
            disabled={loading || !prompt.trim()}
            className="w-full h-8 rounded-md bg-accent text-white text-[11px] font-bold uppercase tracking-wider hover:brightness-110 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {loading ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
            Generate custom ad
          </button>
        </div>
      )}
    </div>
  );
}

function Tab({
  active,
  label,
  sub,
  onClick,
  onDelete,
}: {
  active: boolean;
  label: string;
  sub: string;
  onClick: () => void;
  onDelete?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative h-8 pl-3 pr-${onDelete ? 7 : 3} rounded-md border text-[11px] flex items-center gap-1.5 transition-colors shrink-0 ${
        active
          ? "bg-accent/15 border-accent/40 text-accent"
          : "bg-black/30 border-white/5 text-muted-foreground hover:text-foreground hover:border-white/15"
      }`}
      style={onDelete ? { paddingRight: 28 } : undefined}
    >
      <span className="font-bold">{label}</span>
      <span className="text-[9px] opacity-60 uppercase tracking-wider">{sub}</span>
      {onDelete && (
        <span
          role="button"
          onClick={onDelete}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 size-4 grid place-items-center rounded hover:bg-white/10"
        >
          <X className="size-3" />
        </span>
      )}
    </button>
  );
}
