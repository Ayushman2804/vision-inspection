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
  // The inference service rejects bytes it can't decode with 400; that's the client's file, not an outage.
  if (res.status === 400) throw new HttpError(400, 'Could not read the image; upload a valid JPEG, PNG or WebP file');
  if (res.status === 413) throw new HttpError(413, 'Image too large');
  if (!res.ok) {
    // Full detail goes to the server log only; clients get a generic 502.
    const detail = await res.text().catch(() => '');
    console.error(`Inference service error (${res.status}) ${detail.slice(0, 500)}`);
    throw new HttpError(502, 'Inference service error');
  }
  return res.json();
}
