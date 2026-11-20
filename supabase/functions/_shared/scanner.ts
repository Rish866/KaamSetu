// Malware-scanner adapters. Without configuration, scanning is reported as "unavailable" and files stay quarantined.
export type Verdict = { verdict: 'clean' | 'infected' | 'error'; engine: string; detail?: string };
export type Scanner = { name: string; scan: (bytes: Uint8Array, fileName: string) => Promise<Verdict> };
type Env = (k: string) => string | undefined;

/**
 * clamav-rest: the open-source ClamAV REST wrapper (github.com/ajilach/clamav-rest), self-hosted by the owner.
 * Contract: POST {SCANNER_URL}/v2/scan multipart field "file" -> [{ Status: "OK" | "FOUND" | "ERROR", Description }].
 * Status: adapter written against the documented contract; NOT yet verified against a running instance.
 */
export function scannerFromEnv(env: Env, fetchImpl: typeof fetch = fetch): Scanner | null {
  const kind = env('SCANNER'); const url = env('SCANNER_URL');
  if (!kind || !url) return null;
  if (kind === 'clamav-rest') {
    return { name: 'clamav-rest', async scan(bytes, fileName) {
      const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)]), fileName);
      const headers: Record<string, string> = {}; const token = env('SCANNER_TOKEN'); if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetchImpl(`${url.replace(/\/$/, '')}/v2/scan`, { method: 'POST', body: form, headers });
      if (res.status === 406) return { verdict: 'infected', engine: 'clamav', detail: 'FOUND' };
      if (!res.ok) return { verdict: 'error', engine: 'clamav', detail: `http_${res.status}` };
      const body = await res.json() as { Status?: string; Description?: string }[];
      const s = body?.[0]?.Status;
      if (s === 'OK') return { verdict: 'clean', engine: 'clamav' };
      if (s === 'FOUND') return { verdict: 'infected', engine: 'clamav', detail: String(body[0].Description ?? '').slice(0, 120) };
      return { verdict: 'error', engine: 'clamav', detail: 'unexpected_response' };
    } };
  }
  throw new Error(`unknown_scanner_${kind}`);
}
