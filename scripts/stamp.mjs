// Cache-busting: after each build, tag every CSS/JS URL with the commit hash so browsers
// fetch new code immediately instead of mixing cached old code with fresh data.
import { readFile, writeFile, readdir } from 'node:fs/promises';
const ROOT = new URL('../', import.meta.url);
const V = (process.env.GITHUB_SHA || String(Date.now())).slice(0, 8);
const js = (await readdir(new URL('js/', ROOT))).filter(f => f.endsWith('.js'));
for (const [page, pre] of [['index.html', './'], ['report/index.html', '../']]) {
  let h;
  try { h = await readFile(new URL(page, ROOT), 'utf8'); } catch { continue; }
  h = h.replace(/(href|src)="((?:\.\.\/|\.\/)?(?:css|js)\/[\w-]+\.(?:css|js))"/g, `$1="$2?v=${V}"`);
  const map = { imports: Object.fromEntries(js.map(f => [`${pre}js/${f}`, `${pre}js/${f}?v=${V}`])) };
  h = h.replace('<script type="module"', `<script type="importmap">${JSON.stringify(map)}</script>\n<script type="module"`);
  await writeFile(new URL(page, ROOT), h);
  console.log(`stamped ${page} v=${V}`);
}
