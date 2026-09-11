export type CookKind = 'plan' | 'chef';

export async function complete(prompt: string, kind: CookKind): Promise<string> {
  const response = await fetch('/api/cook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, kind }),
  });
  if (!response.ok) {
    let detail = '';
    try {
      detail = String((await response.json() as { error?: unknown }).error || '');
    } catch {
      detail = '';
    }
    if (response.status === 429) throw new Error('Rate limit reached — give the kitchen a minute.');
    throw new Error(detail || `LLM call failed (${response.status}).`);
  }
  const payload = await response.json() as { text?: string };
  return payload.text || '';
}

export interface RemoteData {
  text: string;
  finalUrl: string;
  contentType: string;
}

export async function fetchRemoteData(url: string): Promise<RemoteData> {
  const response = await fetch('/api/fetch-data', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json() as Record<string, unknown>;
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const detail = payload.detail ? ` (${String(payload.detail).slice(0, 180)})` : '';
    throw new Error(`${String(payload.error || 'fetch_failed')}${detail}`);
  }
  return {
    text: String(payload.text || ''),
    finalUrl: String(payload.finalUrl || url),
    contentType: String(payload.contentType || ''),
  };
}
