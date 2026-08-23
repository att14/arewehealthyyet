import type { SourceHealth } from '../../src/lib/types.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/137.0.0.0 Safari/537.36';

export class FetchFailure extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const HTML_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
};

export async function fetchText(url: string, opts: { attempts?: number; accept?: string } = {}): Promise<string> {
  const attempts = opts.attempts ?? 3;
  const headers = opts.accept
    ? { 'User-Agent': UA, Accept: opts.accept, 'Accept-Language': 'en-US,en;q=0.9' }
    : HTML_HEADERS;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(2 ** i * 1000);
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(45_000),
        redirect: 'follow',
      });
      if (!res.ok) throw new FetchFailure(`HTTP ${res.status} from ${url}`);
      return await res.text();
    } catch (err) {
      lastError = err;
    }
  }
  throw new FetchFailure(`${attempts} attempts failed for ${url}: ${describe(lastError)}`);
}

export async function fetchJson<T>(url: string, opts: { attempts?: number } = {}): Promise<T> {
  const body = await fetchText(url, { ...opts, accept: 'application/json,*/*;q=0.8' });
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new FetchFailure(`Response from ${url} was not valid JSON`);
  }
}

export function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runSource<T>(
  name: string,
  previous: SourceHealth | undefined,
  fn: () => Promise<T>,
): Promise<{ name: string; data: T | null; health: SourceHealth }> {
  const now = new Date().toISOString();
  try {
    const data = await fn();
    console.log(`[${name}] ok`);
    return { name, data, health: { ok: true, fetchedAt: now, lastSuccessAt: now, error: null } };
  } catch (err) {
    const message = describe(err);
    console.error(`[${name}] FAILED: ${message}`);
    return {
      name,
      data: null,
      health: {
        ok: false,
        fetchedAt: now,
        lastSuccessAt: previous?.lastSuccessAt ?? null,
        error: message,
      },
    };
  }
}
