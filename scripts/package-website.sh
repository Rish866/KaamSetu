#!/usr/bin/env bash
# Packages dist/ as a deployable website archive with a manifest and checksums, after verifying it is the right build.
#   scripts/package-website.sh <label> <expected-build-sha>
set -euo pipefail
label="$1"; sha="$2"; out="website-package"
rm -rf "$out"; mkdir -p "$out"
grep -q "name=\"kaamsetu-build\" content=\"$sha\"" dist/index.html || [ "$sha" = "none" ] || { echo "::error::build marker $sha missing in dist/index.html"; exit 1; }
grep -rIq "https://zrexqtzhdkkupyxmfqxd.supabase.co" dist/_expo || { echo "::error::bundle is not configured for the production Supabase project"; exit 1; }
if [ -n "$(find dist -path '*node_modules*' -print -quit)" ]; then
  # The rollback package rebuilds whatever main is live; it may predate the fix, so it is allowed with a warning.
  if [ "${ALLOW_NODE_MODULES_ASSETS:-}" = 1 ]; then echo "::warning::dist contains node_modules assets; icons in this package will 404 on the website host"
  else echo "::error::dist contains a node_modules folder; the website host does not publish it (see scripts/metro-asset-paths.js)"; exit 1; fi
fi
if grep -rIl -E "sb_secret_[A-Za-z0-9_-]{20,}|c2VydmljZV9yb2xl|SUPABASE_SERVICE_ROLE_KEY" dist; then echo "::error::secret key material in dist"; exit 1; fi
(cd dist && find . -type f | sort | xargs sha256sum) > "$out/MANIFEST-$label.sha256"
tar -czf "$out/KaamSetu-web-$label.tar.gz" -C dist .
(cd "$out" && sha256sum "KaamSetu-web-$label.tar.gz" > "KaamSetu-web-$label.tar.gz.sha256")
echo "files: $(wc -l < "$out/MANIFEST-$label.sha256")"; cat "$out/KaamSetu-web-$label.tar.gz.sha256"
