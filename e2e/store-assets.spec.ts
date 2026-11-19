// Generates store graphics and screenshots of public screens. Run with: STORE_ASSETS=1 npx playwright test store-assets
import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.skip(!process.env.STORE_ASSETS, 'Set STORE_ASSETS=1 to regenerate store assets');

test('feature graphic', async ({ page }) => {
  const icon = `data:image/png;base64,${readFileSync('assets/kaamsetu-icon.png').toString('base64')}`;
  await page.setViewportSize({ width: 1024, height: 500 });
  await page.setContent(`<html><body style="margin:0;width:1024px;height:500px;background:linear-gradient(135deg,#171B3D,#25275A 55%,#184B64);font-family:system-ui,sans-serif;display:flex;align-items:center;gap:48px;padding:0 64px;box-sizing:border-box;color:#fff;overflow:hidden">
    <img src="${icon}" style="width:200px;height:200px;border-radius:44px;box-shadow:0 20px 60px rgba(0,0,0,.35)">
    <div><div style="font-size:64px;font-weight:900;letter-spacing:-2px">KaamSetu</div>
    <div style="font-size:30px;line-height:1.3;color:#D9DEEA;margin-top:12px;max-width:600px">Verified jobs. Visible salaries.<br>Match scores that explain themselves.</div>
    <div style="font-size:20px;color:#F6B84A;margin-top:22px;font-weight:700">Mumbai · Navi Mumbai · Thane · Pune</div></div></body></html>`);
  await page.screenshot({ path: 'store/graphics/feature-graphic-1024x500.png' });
});

const sizes = { 'android-phone-1080x1920': { width: 360, height: 640, s: 3 }, 'iphone-6.9in-1290x2796': { width: 430, height: 932, s: 3 }, 'ipad-13in-2048x2732': { width: 1024, height: 1366, s: 2 } } as const;
for (const [name, vp] of Object.entries(sizes)) {
  test(`screenshots ${name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.s });
    const p = await ctx.newPage();
    for (const [slug, path] of [['1-home', '/'], ['2-candidate-sign-in', '/login?role=candidate'], ['3-employer-sign-in', '/login?role=employer'], ['4-privacy', '/privacy']]) {
      await p.goto(path); await p.waitForLoadState('networkidle'); await p.screenshot({ path: `store/screenshots/${name}-${slug}.png` });
    }
    await ctx.close();
  });
}
