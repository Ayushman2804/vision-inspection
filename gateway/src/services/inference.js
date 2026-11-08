import { config } from '../config.js';
import { HttpError } from '../utils.js';

/** Forward an image to the FastAPI inference service and return its JSON. */
export async function runInference(buffer, mimetype, conf) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype }), 'image');
  let res;
  try {
    res = await fetch(`${config.inferenceUrl}/predict?conf=${conf}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new HttpError(502, 'Inference service unreachable');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new HttpError(502, `Inference service error (${res.status}) ${detail.slice(0, 200)}`);
  }
  return res.json();
}
