export async function generateVoiceoverAudio(args: {
  script: string;
  profile: string;
}): Promise<{ audioDataUrl: string; voiceName: string }> {
  void args;
  throw new Error(
    "Built-in voiceover generation is browser-based in this setup. Record or upload a voiceover, or use preview speech in the editor.",
  );
}
