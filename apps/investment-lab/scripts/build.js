import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCSV } from '../src/data.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const source = path.resolve(root, '../../experiments/btc-regime-validation/sources/btc-usd-bitstamp.csv');
const parsed = parseCSV(await readFile(source, 'utf8'));

const version = (process.env.GITHUB_SHA || 'dev').slice(0, 12);
const srcDir = `src-${version}`;
const stylesFile = `styles.${version}.css`;
const dataFile = `btc-usd.${version}.csv`;
const chartsFile = `charts.${version}.mjs`;

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'vendor'), { recursive: true });

// Version every runtime asset URL so a normal reload can never reuse JS/CSS/data
// from an older GitHub Pages deployment.
let html = await readFile(path.join(root, 'index.html'), 'utf8');
html = html
  .replace('./styles.css', `./${stylesFile}`)
  .replace('./src/app.js', `./${srcDir}/app.js`)
  .replace('./btc-usd.csv', `./${dataFile}`);
await writeFile(path.join(dist, 'index.html'), html);

await cp(path.join(root, 'styles.css'), path.join(dist, stylesFile));
await cp(path.join(root, 'src'), path.join(dist, srcDir), { recursive: true });
await cp(source, path.join(dist, dataFile));

const appPath = path.join(dist, srcDir, 'app.js');
let app = await readFile(appPath, 'utf8');
app = app
  .replace("../vendor/charts.mjs", `../vendor/${chartsFile}`)
  .replace("fetch('./btc-usd.csv')", `fetch('./${dataFile}')`);
await writeFile(appPath, app);

const library = path.dirname(fileURLToPath(import.meta.resolve('lightweight-charts')));
await cp(
  path.join(library, 'lightweight-charts.standalone.production.mjs'),
  path.join(dist, 'vendor', chartsFile)
);
await cp(path.join(library, '..', 'LICENSE'), path.join(dist, 'vendor/LICENSE'));
await cp(path.join(root, 'NOTICE'), path.join(dist, 'vendor/NOTICE'));

await writeFile(
  path.join(dist, 'data-info.json'),
  JSON.stringify({
    ...parsed.metadata,
    build_version: version,
    first: parsed.candles[0].time,
    last: parsed.candles.at(-1).time,
    count: parsed.candles.length
  }, null, 2)
);

console.log(`Built Investment Lab ${version}: ${parsed.candles.length} daily candles through ${parsed.candles.at(-1).time}`);
