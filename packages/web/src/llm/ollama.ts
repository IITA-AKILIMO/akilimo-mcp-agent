// Downloads models into the Ollama this site uses, through the same-origin /proxy/ollama path
// (vite.config.ts, nginx.conf). Model calls themselves run on the server (packages/server/src/chat).
const BASE = '/proxy/ollama';

export interface PullProgress {
  status: string; // e.g. "pulling manifest", "downloading", "verifying sha256 digest", "success"
  completed?: number;
  total?: number;
}

// Downloads a model into the local Ollama (POST /api/pull streams one JSON object per line)
export async function pullModel(name: string, onProgress: (p: PullProgress) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${BASE}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: name, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += value;
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as PullProgress & { error?: string };
      if (event.error) throw new Error(event.error);
      onProgress(event);
    }
    if (done) return;
  }
}
