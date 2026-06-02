const ELEVENLABS_MODEL = "eleven_multilingual_v2";

export async function generateVoiceoverAudio(args: {
  script: string;
  profile: string;
}): Promise<{ audioDataUrl: string; voiceName: string }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Voiceover generation needs ELEVENLABS_API_KEY. You can still upload or record a voiceover.",
    );
  }

  const voiceId = pickVoiceId(args.profile);
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: args.script.slice(0, 2400),
      model_id: process.env.ELEVENLABS_MODEL_ID || ELEVENLABS_MODEL,
      voice_settings: {
        stability: /deep|cinematic|confident/i.test(args.profile) ? 0.56 : 0.48,
        similarity_boost: 0.78,
        style: /energetic|young/i.test(args.profile) ? 0.42 : 0.18,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const message = await res.text().catch(() => "");
    throw new Error(`Voiceover generation failed (${res.status}). ${message.slice(0, 180)}`);
  }

  const audio = await res.arrayBuffer();
  return {
    audioDataUrl: `data:audio/mpeg;base64,${arrayBufferToBase64(audio)}`,
    voiceName: /warm|female|inviting/i.test(args.profile)
      ? "Generated female voice"
      : "Generated male voice",
  };
}

function pickVoiceId(profile: string): string {
  if (/warm|female|inviting/i.test(profile)) {
    return (
      process.env.ELEVENLABS_FEMALE_VOICE_ID ||
      process.env.ELEVENLABS_VOICE_ID ||
      "EXAVITQu4vr4xnSDxMaL"
    );
  }
  return (
    process.env.ELEVENLABS_MALE_VOICE_ID ||
    process.env.ELEVENLABS_VOICE_ID ||
    "TxGEqnHWrfWFTfGW9XjX"
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
