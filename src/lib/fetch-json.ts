// Tiny fetch helper shared by the English deck's online lookups: JSON with a
// hard timeout, swallowing every error to null (offline / CORS / bad status),
// so callers can just fall through to the next source.

export async function fetchJson(url: string, ms = 6000): Promise<unknown | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
