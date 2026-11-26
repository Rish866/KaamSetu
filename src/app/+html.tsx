import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Static HTML shell for the web build. Security and SEO metadata live here.
// connect-src is limited to the Supabase project this build is configured for (read at build time).
const supabaseOrigin = (() => {
  try { return new URL(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').origin; } catch { return 'https://*.supabase.co'; }
})();
const wsOrigin = supabaseOrigin.replace(/^http/, 'ws');
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabaseOrigin}`,
  "font-src 'self' data:",
  // blob: is required: picked files are read with fetch(blob:...) before upload (caught by the local-stack UI test).
  `connect-src 'self' blob: ${supabaseOrigin} ${wsOrigin}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// SDK 58: custom HTML must render headNodes/bodyNodes (https://docs.expo.dev/router/web/static-rendering/).
export default function Root({ children }: PropsWithChildren) {
  const { headNodes, bodyNodes, htmlAttributes, bodyAttributes } = useServerDocumentContext();
  return <html lang="en" {...htmlAttributes}>
    <head>
      <meta charSet="utf-8" />
      <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
      <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
      <meta httpEquiv="Content-Security-Policy" content={csp} />
      <meta name="referrer" content="strict-origin-when-cross-origin" />
      <meta name="kaamsetu-build" content={process.env.EXPO_PUBLIC_BUILD_SHA ?? 'local'} />
      <title>KaamSetu: verified jobs with visible salaries</title>
      <meta name="description" content="KaamSetu connects candidates with verified employers across India. Every job shows its salary and every match score explains itself." />
      <ScrollViewStyleReset />
      {headNodes}
    </head>
    <body {...bodyAttributes}>{children}{bodyNodes}</body>
  </html>;
}
