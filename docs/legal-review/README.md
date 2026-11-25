# Legal review pack

`KaamSetu-legal-review-2026-11-25.docx` (editable, for tracked changes) and `.pdf` (read-only) combine, for the lawyer:
facts about how the service runs today, the open questions, the exact Privacy Notice / Terms / Support text from
`src/content/legal.ts`, `docs/PRIVACY.md` and `docs/store/PRIVACY_DISCLOSURES.md`.

Rebuild after any of those files change:
```
node --experimental-strip-types -e "import('./src/content/legal.ts').then(m=>console.log(JSON.stringify({version:m.NOTICE_VERSION,pages:m.legalPages})))" > legal.json
pip install python-docx && python3 scripts/build-legal-pack.py legal.json docs/legal-review/KaamSetu-legal-review-<date>
# then print the .html to PDF (any browser: Print > Save as PDF) and delete the .html
```
