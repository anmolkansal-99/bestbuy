// Renders sample emails (no network, no sending) so you can see what the reports look like:
//   npm run demo   ->   out/demo-report.html, out/demo-baseline.html, out/demo-comparison.csv
import fs from 'node:fs/promises';
import path from 'node:path';
import { LAPTOPS as L, detailFor } from './fixtures.js';
import { normalizeProduct, extractDetails } from '../src/normalize.js';
import { buildReport } from '../src/report.js';
import { config } from '../src/config.js';

const now = new Date();
const entry = (p) => ({ ...normalizeProduct(p), firstSeenAt: now.toISOString(), missCount: 0 });

const asus = entry(L.asus);
const msi = entry({ ...L.msi, salePrice: 1199.99 });
const lenovo = entry({ ...L.lenovo, availability: L.asus.availability });
const acer = entry(L.acer);
const alienware = entry(L.alienware);
const razer = entry(L.razer);
const hp = entry(L.hp);

const entries = [asus, msi, lenovo, acer, alienware, razer];
const empty = { newListings: [], relisted: [], priceDrops: [], priceRises: [], restocks: [], soldOutOnline: [], removed: [], unchanged: 0 };

const changes = buildReport({
  result: {
    ...empty,
    baseline: false,
    newListings: [razer, alienware],
    priceDrops: [{ item: msi, oldPrice: 1349.99, newPrice: 1199.99, amount: 150, percent: 11.1 }],
    restocks: [{ item: lenovo }],
    removed: [hp],
  },
  entries,
  stats: {
    before: { count: 5, cheapest: 749.99, median: 1049.99 },
    after: { count: 6, cheapest: 749.99, median: 1124.99 },
  },
  coverage: { read: 6, total: 6, pages: 1 }, // "checked N of N": proves every "Show more" page was read
  now,
  details: { [razer.sku]: extractDetails(detailFor(razer.sku)) },
});

const baseline = buildReport({
  result: { ...empty, baseline: true, newListings: entries },
  entries,
  stats: { before: { count: 0 }, after: { count: entries.length } },
  coverage: { read: entries.length, total: entries.length, pages: 1 },
  now,
});

await fs.mkdir(config.outDir, { recursive: true });
await fs.writeFile(path.join(config.outDir, 'demo-report.html'), changes.html);
await fs.writeFile(path.join(config.outDir, 'demo-report.txt'), changes.text);
await fs.writeFile(path.join(config.outDir, 'demo-comparison.csv'), changes.attachments[0].content);
await fs.writeFile(path.join(config.outDir, 'demo-baseline.html'), baseline.html);
console.log(`Subject: ${changes.subject}\nWritten to ${config.outDir}`);
