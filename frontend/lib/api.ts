// Called directly against the backend (not through Next's /api rewrite
// proxy): the dev-server rewrite proxy has its own ~30s timeout and resets
// the connection ("socket hang up") before a real full-length song finishes
// mastering. The backend already sends CORS headers for this origin, so a
// direct cross-origin fetch works and has no artificial timeout.
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export interface MasterParams {
  prompt: string;
  bass: number;
  vocal: number;
  clarity: number;
  targetLufs: number;
  antiAiIntensity: number;
  choppingIntensity: number;
  reverbMix: number;
  reverbSize: number;
  reverbTone: number;
  stretchSpeed: number;
  stretchPitch: number;
}

export interface MasterResult {
  blob: Blob;
  filename: string;
  report: Record<string, unknown> | null;
}

export interface AiPreset {
  low_gain_db: number;
  mid_gain_db: number;
  high_gain_db: number;
  reverb_on: boolean;
  reverb_mix: number;
  chopping_level: number;
  target_lufs: number;
}

export interface AnalyzeResult {
  snapshot: { low_db: number; mid_db: number; high_db: number };
  preset: AiPreset;
}

/**
 * Calls the FastAPI backend's /api/analyze endpoint: a fast, render-free
 * pre-flight step that asks Gemini for a starting mastering preset from a
 * quick frequency snapshot + the style prompt.
 */
export async function analyzeTrack(file: File, prompt: string): Promise<AnalyzeResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("prompt", prompt ?? "");

  const res = await fetch(`${BACKEND_URL}/api/analyze`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errJson = await res.json();
      detail = errJson.detail ?? detail;
    } catch {
      // ignore
    }
    throw new Error(`AI 분석 실패 (${res.status}): ${detail}`);
  }

  return res.json();
}

/**
 * Calls the FastAPI backend's /api/master endpoint and returns the
 * mastered .wav file as a Blob, ready to be downloaded.
 */
export async function masterTrack(
  file: File,
  params: MasterParams
): Promise<MasterResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("prompt", params.prompt ?? "");
  form.append("bass", String(params.bass));
  form.append("vocal", String(params.vocal));
  form.append("clarity", String(params.clarity));
  form.append("target_lufs", String(params.targetLufs));
  form.append("anti_ai_intensity", String(params.antiAiIntensity));
  form.append("chopping_intensity", String(params.choppingIntensity));
  form.append("reverb_mix", String(params.reverbMix));
  form.append("reverb_size", String(params.reverbSize));
  form.append("reverb_tone", String(params.reverbTone));
  form.append("stretch_speed", String(params.stretchSpeed));
  form.append("stretch_pitch", String(params.stretchPitch));

  const res = await fetch(`${BACKEND_URL}/api/master`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const errJson = await res.json();
      detail = errJson.detail ?? detail;
    } catch {
      // ignore
    }
    throw new Error(`마스터링 실패 (${res.status}): ${detail}`);
  }

  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? `mastered_${file.name.replace(/\.[^/.]+$/, "")}.wav`;

  let report: Record<string, unknown> | null = null;
  const reportHeader = res.headers.get("X-Master-Report");
  if (reportHeader) {
    try {
      report = JSON.parse(reportHeader);
    } catch {
      report = null;
    }
  }

  const blob = await res.blob();
  return { blob, filename, report };
}

/** Triggers an immediate browser download of a Blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
