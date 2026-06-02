import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getProject, updateProject, regenerateScript } from "@/lib/ad.functions";
import { useEditor } from "@/store/editor-store";
import { EditorShell } from "@/components/editor/EditorShell";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/editor/$projectId")({
  component: EditorPage,
});

function EditorPage() {
  const { projectId } = Route.useParams();
  const fetchProject = useServerFn(getProject);
  const save = useServerFn(updateProject);
  const regen = useServerFn(regenerateScript);

  const q = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject({ data: { id: projectId } }),
  });

  const setProject = useEditor((s) => s.setProject);
  const project = useEditor((s) => s.project);
  const dirty = useEditor((s) => s.dirty);
  const markSaved = useEditor((s) => s.markSaved);

  // hydrate store when query resolves
  useEffect(() => {
    if (q.data) {
      setProject(q.data);
      try {
        sessionStorage.setItem(`ad-studio-project-${q.data.id}`, JSON.stringify(q.data));
      } catch {
        // Browser storage is a convenience fallback; server/Supabase remains the source of truth.
      }
    }
  }, [q.data, setProject]);

  useEffect(() => {
    if (!q.error) return;
    try {
      const raw = sessionStorage.getItem(`ad-studio-project-${projectId}`);
      if (raw) setProject(JSON.parse(raw));
    } catch {
      // Keep the normal load error if no browser handoff exists.
    }
  }, [projectId, q.error, setProject]);

  // debounced autosave
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!dirty || !project) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        sessionStorage.setItem(`ad-studio-project-${project.id}`, JSON.stringify(project));
      } catch {
        // Very large data-URL image sets can exceed browser storage.
      }
      await save({
        data: {
          id: project.id,
          patch: {
            brand: project.brand,
            script: project.script,
            scenes: project.scenes,
            end_card: project.endCard,
            duration_sec: project.durationSec,
            music_genre: project.musicGenre ?? null,
            music_audio_data_url: project.musicAudioDataUrl ?? null,
            music_audio_name: project.musicAudioName ?? null,
            music_bed_id: project.musicBedId ?? null,
            ad_category: project.adCategory ?? null,
            ad_template: project.adTemplate ?? null,
            voiceover_audio_data_url: project.voiceoverAudioDataUrl ?? null,
            voiceover_audio_name: project.voiceoverAudioName ?? null,
            qr_code_data_url: project.qrCodeDataUrl,
          },
        },
      });
      markSaved();
    }, 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [dirty, project, save, markSaved]);

  if (q.isLoading || (!project && !q.error)) {
    return (
      <div className="min-h-screen bg-background grid place-items-center">
        <Loader2 className="size-6 text-accent animate-spin" />
      </div>
    );
  }
  if (q.error) {
    if (project) return <EditorShell onRegenerate={() => regen({ data: { id: project.id } })} />;
    return (
      <div className="min-h-screen bg-background grid place-items-center text-sm text-destructive">
        Failed to load project.
      </div>
    );
  }

  return <EditorShell onRegenerate={() => regen({ data: { id: project.id } })} />;
}
