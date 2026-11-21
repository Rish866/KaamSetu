import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/** Sign-in methods enabled on the Supabase project (public GoTrue settings). Phone is hidden if the project disables it. */
export function useAuthMethods() {
  const [methods, setMethods] = useState<{ email: boolean; phone: boolean }>({ email: true, phone: true });
  useEffect(() => {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL; const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return;
    let alive = true;
    fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { external?: { email?: boolean; phone?: boolean } } | null) => { if (alive && s?.external) setMethods({ email: s.external.email !== false, phone: s.external.phone === true }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return methods;
}

/** Server-side feature flags (e.g. resume uploads stay off until a malware scanner is verified). */
export function usePlatformFlags() {
  const [flags, setFlags] = useState<{ resume_uploads_enabled: boolean } | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.resolve(supabase.rpc('platform_flags')).then(({ data }) => { if (alive) setFlags((data as { resume_uploads_enabled: boolean } | null) ?? { resume_uploads_enabled: false }); }, () => undefined);
    return () => { alive = false; };
  }, []);
  return flags;
}

/**
 * Path prefix the website is hosted under ('' at the domain root, '/KaamSetu' on GitHub Pages project sites).
 * Set at export time from app.json `experiments.baseUrl`; Expo Router uses the same value for links.
 */
export const webBasePath = (process.env.EXPO_BASE_URL ?? '').replace(/\/+$/, '');
