// End-to-end tests: a mock Best Buy API + a local SMTP server, driving the real code paths.
//   node test/run-tests.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-bestbuy.js';
import { startSink } from './smtp-sink.js';
import { LAPTOPS as L, makeProduct } from './fixtures.js';

const base = process.env.TEST_TMP || os.tmpdir();
const tmp = fs.mkdtempSync(path.join(base, 'bbm-test-'));
const stateFile = path.join(tmp, 'state.json');

const mock = await startMock();
const sink = await startSink();

Object.assign(process.env, {
  API_BASE: `http://127.0.0.1:${mock.port}`,
  STATE_FILE: stateFile,
  OUT_DIR: path.join(tmp, 'out'),
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: String(sink.port),
  SMTP_SECURE: 'false',
  SMTP_IGNORE_TLS: 'true',
  MAIL_TO: 'me@example.test',
  MAIL_FROM: 'monitor@example.test',
  PAGE_SIZE: '2', // forces several pages per poll
  PAGE_DELAY_MIN_MS: '0',
  PAGE_DELAY_MAX_MS: '0',
  REREAD_DELAY_MIN_MS: '0',
  REREAD_DELAY_MAX_MS: '0',
  RETRY_BASE_MS: '5',
  MAIL_RETRIES: '2',
  MAIL_RETRY_BASE_MS: '5',
  NO_PROXY: '127.0.0.1,localhost',
});

const { runOnce } = await import('../src/run.js');
const { buildSearchUrl, deriveQuery, fetchAllListings } = await import('../src/fetcher.js');
const { buildReport } = await import('../src/report.js');
const { config, DEFAULT_PAGE_URL } = await import('../src/config.js');
const { normalizeProduct, parseSpecsFromName, readAvailability } = await import('../src/normalize.js');
const { closeTransport } = await import('../src/mailer.js');

const T0 = new Date('2026-10-28T03:00:00Z');
const at = (minutes) => new Date(T0.getTime() + minutes * 60_000);
const readState = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const resetState = () => fs.rmSync(stateFile, { force: true });
const mails = () => sink.messages.length;
const last = () => sink.messages[sink.messages.length - 1];
const html = (m) => String(m.html);
const csvOf = (m) => m.attachments.find((a) => a.filename.endsWith('.csv'))?.content.toString('utf8') ?? '';

let passed = 0;
let failed = 0;
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${String(err.stack ?? err).split('\n').slice(0, 6).join('\n       ')}`);
  }
}

console.log('\nrequest building');
await step('API URL copies the filter path from the page URL untouched', () => {
  const { categoryId, rawPath } = deriveQuery(DEFAULT_PAGE_URL);
  assert.equal(categoryId, '36712');
  assert.ok(rawPath.startsWith('category%253AComputers%2B%2526%2BTablets'));
  assert.ok(rawPath.endsWith('currentPrice%253A%5B200%2520TO%25201950%5D'));
  const url = buildSearchUrl(2, 24);
  assert.ok(url.includes('/api/v2/json/search?categoryid=36712'));
  assert.ok(url.includes('page=2&pageSize=24'));
  assert.ok(url.includes(`path=${rawPath}`));
});

console.log('\nnormalising listings');
await step('title specs, condition, availability and missing fields', () => {
  const n = normalizeProduct(L.asus);
  assert.equal(n.condition, 'Open Box');
  assert.equal(n.brand, 'ASUS');
  assert.equal(n.price, 899.99);
  assert.ok(n.url.startsWith('https://www.bestbuy.ca/en-ca/product/'), n.url);
  assert.ok(n.url.endsWith('/19810001'), n.url);
  assert.equal(normalizeProduct(L.msi).condition, 'Geek Squad Open Box');
  assert.equal(normalizeProduct(L.lenovo).condition, 'Refurbished (Excellent)');
  assert.deepEqual(parseSpecsFromName(L.asus.name), {
    screen: '15.6"',
    refresh: '144 Hz',
    cpu: 'Intel Core i7-12700H',
    ram: '16GB RAM',
    storage: '512GB SSD',
    gpu: 'GeForce RTX 3060',
  });
  assert.equal(parseSpecsFromName(L.alienware.name).cpu, 'Intel Core Ultra 7 155H');
  assert.equal(readAvailability(L.lenovo).buyable, false);
  assert.equal(readAvailability(L.asus).buyable, true);
  assert.equal(readAvailability({}).buyable, null);
  const bare = normalizeProduct({ sku: 1, name: 'Mystery laptop' });
  assert.equal(bare.price, null);
  assert.equal(bare.url, 'https://www.bestbuy.ca/en-ca/product/1');
});

console.log('\nbaseline');
await step('first poll sends the starting snapshot and stores every laptop (across 3 pages)', async () => {
  resetState();
  mock.products = [L.asus, L.msi, L.lenovo, L.acer, L.hp];
  const r = await runOnce({ now: at(0) });
  assert.equal(r.kind, 'baseline');
  assert.equal(r.emailed, true);
  assert.equal(mails(), 1);
  assert.match(last().subject, /Monitor started: tracking 5 laptops/);
  assert.match(html(last()), /TUF Gaming F15/);
  assert.match(html(last()), /Sanity check: .*Open Box/);
  assert.equal(csvOf(last()).trim().split(/\r?\n/).length, 6); // header + 5
  assert.equal(Object.keys(readState().listings).length, 5);
  assert.equal(readState().baselineDone, true);
  assert.ok(mock.requests.filter((u) => u.includes('/search')).length >= 3, 'expected pagination');
  assert.deepEqual(r.coverage, { read: 5, total: 5, pages: 3 });
  assert.match(html(last()), /Checked the complete list: 5 of 5 listings \(3 pages of results\)/);
});

await step('an unchanged site sends nothing and does not touch the snapshot', async () => {
  const before = fs.readFileSync(stateFile, 'utf8');
  const r = await runOnce({ now: at(5) });
  assert.equal(r.kind, 'nochange');
  assert.equal(r.emailed, false);
  assert.equal(r.stateSaved, false);
  assert.equal(mails(), 1);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), before);
});

console.log('\nchanges');
await step('new laptop + price drop + restock arrive in ONE comparison email', async () => {
  mock.products = [
    L.asus,
    { ...L.msi, salePrice: 1049.99 }, // price drop
    { ...L.lenovo, availability: L.asus.availability }, // restock
    L.acer,
    L.hp,
    L.razer, // new
  ];
  const r = await runOnce({ now: at(10) });
  assert.equal(r.kind, 'changes');
  assert.equal(mails(), 2);
  const m = last();
  assert.match(m.subject, /1 new laptop from \$1,599\.99/);
  assert.match(m.subject, /1 price drop/);
  assert.match(m.subject, /1 back in stock/);
  const h = html(m);
  assert.match(h, /Razer Blade 14/);
  assert.match(h, /Old vs new/);
  assert.match(h, /Price drops/);
  assert.match(h, /Back in stock/);
  assert.match(h, /Fast gaming laptop with a high-refresh display/, 'detail description is included');
  assert.match(h, /Processor Model/, 'detail specs are included');
  assert.match(h, /19810007/);
  const csv = csvOf(m);
  assert.match(csv, /NEW,19810007/);
  assert.match(csv, /PRICE_DROP,19810002/);
  assert.match(csv, /BACK_IN_STOCK,19810003/);
  assert.match(csv, /UNCHANGED,19810001/);
  // the whole list is in the email too, with an old-vs-new status per laptop (3 unchanged ones here)
  assert.match(h, /Full list: every laptop, old vs new/);
  assert.equal(h.split('>Same</span>').length - 1, 3, 'unchanged laptops are listed as "Same"');
  assert.match(h, /Checked the complete list: 6 of 6 listings \(3 pages of results\)/);
  assert.match(String(m.text), /FULL LIST \(6\)/);
  assert.match(String(m.text), /\[NEW\s*\]\s+\$1,599\.99\s+Open Box - Razer Blade 14/);
  const st = readState();
  assert.equal(Object.keys(st.listings).length, 6);
  assert.equal(st.listings['19810002'].price, 1049.99);
  assert.equal(st.listings['19810002'].priceHistory.length, 2);
});

await step('details endpoint failing does not stop the email', async () => {
  mock.withDetails = false;
  mock.products = [...mock.products, L.alienware];
  const r = await runOnce({ now: at(15) });
  mock.withDetails = true;
  assert.equal(r.emailed, true);
  assert.match(last().subject, /Alienware m16 R2/);
  assert.doesNotMatch(html(last()), /Fast gaming laptop with a high-refresh display/);
});

console.log('\nglitch tolerance');
await step('a laptop missing for 1-2 polls is not reported; after 3 it is "gone"; coming back is reported', async () => {
  const withoutAcer = mock.products.filter((p) => p.sku !== L.acer.sku);
  const baseCount = mails();

  mock.products = withoutAcer;
  await runOnce({ now: at(20) });
  await runOnce({ now: at(25) });
  assert.equal(mails(), baseCount, 'no email for a short glitch');
  assert.equal(readState().listings[L.acer.sku].missCount, 2);

  const third = await runOnce({ now: at(30) });
  assert.equal(third.result.removed.length, 1);
  assert.equal(mails(), baseCount, 'removal alone does not email by default');
  assert.ok(readState().gone[L.acer.sku]);
  assert.equal(readState().listings[L.acer.sku], undefined);

  mock.products = [...withoutAcer, L.acer];
  const back = await runOnce({ now: at(35) });
  assert.equal(back.result.relisted.length, 1);
  assert.equal(mails(), baseCount + 1);
  assert.match(html(last()), /Back on the list/);
  assert.equal(readState().gone[L.acer.sku], undefined);
});

console.log('\nfailures');
await step('a blocked site: silent at first, one alert after 45 min, one recovery notice', async () => {
  const n0 = mails();
  mock.mode = 'block';
  const a = await runOnce({ now: at(60) });
  assert.equal(a.kind, 'failure');
  assert.equal(a.error, 'blocked:403');
  assert.equal(mails(), n0);
  assert.ok(readState().outage);

  await runOnce({ now: at(90) });
  assert.equal(mails(), n0, 'still under the 45-minute threshold');

  const c = await runOnce({ now: at(110) });
  assert.equal(c.emailed, true);
  assert.equal(mails(), n0 + 1);
  assert.match(last().subject, /can't read Best Buy \(blocked:403\)/);

  await runOnce({ now: at(130) });
  assert.equal(mails(), n0 + 1, 'no repeat inside the reminder window');

  mock.mode = 'ok';
  await runOnce({ now: at(140) });
  assert.equal(mails(), n0 + 2);
  assert.match(last().subject, /reading Best Buy again/);
  assert.equal(readState().outage, null);
});

await step('a page returning HTML, broken JSON, a wrong shape, or HTTP 500 mid-listing is a failure and never touches the snapshot', async () => {
  const snapshot = JSON.stringify(readState().listings);
  for (const [mode, expected] of [['html200', /^blocked/], ['badjson', /^bad_json/], ['wrongshape', /^bad_shape/]]) {
    mock.mode = mode;
    const r = await runOnce({ now: at(200) });
    assert.equal(r.ok, false);
    assert.match(r.error, expected, mode);
  }
  mock.mode = 'ok';
  mock.failPage = 2;
  const r = await runOnce({ now: at(200) });
  mock.failPage = null;
  assert.equal(r.ok, false);
  assert.match(r.error, /^http:500/);
  assert.equal(JSON.stringify(readState().listings), snapshot, 'half-read listings must not cause "removed" laptops');
  await runOnce({ now: at(205) }); // site healthy again; clears the silent outage
  assert.equal(readState().outage, null);
});

await step('if the email cannot be sent the new laptop is NOT forgotten; the next poll delivers it', async () => {
  const n0 = mails();
  mock.products = [...mock.products, makeProduct({ sku: 19819999, name: 'Open Box - Gigabyte G6 16" 165Hz Gaming Laptop (Intel Core i7-13620H/16GB RAM/1TB SSD/GeForce RTX 4060)', price: 1099.99 })];
  sink.refuse = true;
  await assert.rejects(runOnce({ now: at(300) }), /Could not send email/);
  assert.equal(readState().listings['19819999'], undefined, 'snapshot must not advance');
  sink.refuse = false;
  const r = await runOnce({ now: at(305) });
  assert.equal(r.emailed, true);
  assert.equal(mails(), n0 + 1);
  assert.match(last().subject, /Gigabyte G6/);
  assert.ok(readState().listings['19819999']);
});

console.log('\nhousekeeping');
await step('a heartbeat touches the snapshot every ~20 days, and only once', async () => {
  const before = readState().lastHeartbeatAt;
  const r1 = await runOnce({ now: at(60 * 24 * 21) });
  assert.equal(r1.emailed, false);
  assert.equal(r1.stateSaved, true);
  assert.notEqual(readState().lastHeartbeatAt, before);
  const r2 = await runOnce({ now: at(60 * 24 * 21 + 5) });
  assert.equal(r2.stateSaved, false);
});

await step('zero results on the very first poll does not "use up" the baseline', async () => {
  resetState();
  mock.products = [];
  const n0 = mails();
  const r = await runOnce({ now: at(0) });
  assert.equal(r.kind, 'baseline');
  assert.equal(mails(), n0);
  assert.equal(readState().baselineDone, false);
  mock.products = [L.asus];
  const r2 = await runOnce({ now: at(5) });
  assert.equal(r2.kind, 'baseline');
  assert.equal(mails(), n0 + 1);
});

await step('config is read from the environment (recipient, pagination)', () => {
  assert.deepEqual(config.mail.to, ['me@example.test']);
  assert.equal(config.pageSize, 2);
});

console.log('\nthe complete list ("Show more" pages)');
const many = (n, start = 0) =>
  Array.from({ length: n }, (_, i) =>
    makeProduct({
      sku: 19830000 + start + i,
      name: `Open Box - Test Laptop ${start + i + 1} 15.6" 144Hz Gaming Laptop (Intel Core i7-12700H/16GB RAM/512GB SSD/GeForce RTX 4060)`,
      price: 800 + (start + i) * 10,
    }),
  );
const pageOf = (u) => Number(new URL(u, 'http://mock').searchParams.get('page'));
const searchPages = () => mock.requests.filter((u) => u.includes('/search')).map(pageOf);
const seven = () => [L.asus, L.msi, L.lenovo, L.acer, L.hp, L.alienware, L.razer];

await step('a 7-laptop list over 4 pages is read page by page and checked against the site total', async () => {
  resetState();
  mock.products = seven();
  mock.requests.length = 0;
  const r = await runOnce({ now: at(0) });
  assert.deepEqual(searchPages(), [1, 2, 3, 4], 'one request per page, in order, no repeats');
  assert.deepEqual(r.coverage, { read: 7, total: 7, pages: 4 });
  assert.equal(Object.keys(readState().listings).length, 7);
  assert.match(html(last()), /Checked the complete list: 7 of 7 listings \(4 pages of results\)/);
  assert.match(html(last()), /The website should show 7 items/);
  assert.equal(csvOf(last()).trim().split(/\r?\n/).length, 8);
});

await step('then a NEW laptop on the last page and a price drop on the first page arrive in one email, with the whole list', async () => {
  const fresh = makeProduct({ sku: 19819001, name: 'Open Box - Gigabyte G6 16" 165Hz Gaming Laptop (Intel Core i7-13620H/16GB RAM/1TB SSD/GeForce RTX 4060)', price: 1099.99 });
  mock.products = [{ ...L.asus, salePrice: 849.99 }, ...seven().slice(1), fresh];
  mock.requests.length = 0;
  const n0 = mails();
  const r = await runOnce({ now: at(5) });
  assert.deepEqual(searchPages(), [1, 2, 3, 4]);
  assert.equal(r.kind, 'changes');
  assert.deepEqual(r.coverage, { read: 8, total: 8, pages: 4 });
  assert.deepEqual(r.result.newListings.map((i) => i.sku), ['19819001']);
  assert.equal(r.result.priceDrops.length, 1);
  assert.equal(mails(), n0 + 1);
  const h = html(last());
  assert.match(h, /Full list: every laptop, old vs new <span[^>]*>\(8\)/);
  for (const name of ['TUF Gaming F15', 'Katana 15', 'LOQ', 'Nitro V', 'Victus', 'Alienware m16', 'Razer Blade 14', 'Gigabyte G6']) {
    assert.ok(h.includes(name), `${name} should be listed`);
  }
  assert.equal(h.split('>Same</span>').length - 1, 6, 'the six untouched laptops are listed as "Same"');
  assert.equal(csvOf(last()).trim().split(/\r?\n/).length, 9);
});

await step('a site that does not report totals is read until it runs dry (no stopping after a short page)', async () => {
  resetState();
  mock.hideTotals = true;
  mock.products = [L.asus, L.msi, L.lenovo, L.acer, L.hp];
  mock.requests.length = 0;
  let r;
  try {
    r = await runOnce({ now: at(0) });
  } finally {
    mock.hideTotals = false;
  }
  assert.equal(r.coverage.read, 5);
  assert.equal(r.coverage.total, null);
  assert.equal(r.coverage.pages, 3);
  assert.ok(searchPages().includes(4), 'asked for the page after the last one to be sure the list was over');
  assert.match(html(last()), /Read 5 listings \(3 pages of results\); the site did not say how many there should be/);
});

await step('a laptop sold while the list is being read cannot make a NEW laptop slip through (the list is re-read)', async () => {
  const sellFirstOnPage2 = () => {
    let done = false;
    mock.onSearch = (page) => {
      if (page === 2 && !done) {
        done = true;
        mock.products = mock.products.slice(1); // the first laptop sells right after page 1 was read: everything shifts up by one
      }
    };
  };
  const before = [L.asus, L.msi, L.acer, L.hp, L.alienware];
  const after = [L.asus, L.msi, L.razer, L.acer, L.hp, L.alienware]; // razer is new and sits at the start of page 2
  try {
    // control: a single read (how a simple scraper works) would have skipped it
    mock.products = after;
    sellFirstOnPage2();
    const single = await fetchAllListings({ passes: 1 });
    mock.onSearch = null;
    assert.ok(!single.raw.some((p) => p.sku === L.razer.sku), 'control: one read skips the shifted laptop');

    resetState();
    mock.products = before;
    await runOnce({ now: at(0) }); // baseline
    mock.products = after;
    sellFirstOnPage2();
    const n0 = mails();
    const r = await runOnce({ now: at(5) });
    assert.equal(r.kind, 'changes');
    assert.deepEqual(r.result.newListings.map((i) => i.sku), [L.razer.sku]);
    assert.equal(mails(), n0 + 1);
    assert.match(last().subject, /Razer Blade 14/);
  } finally {
    mock.onSearch = null;
  }
});

await step('a page that comes back empty once is fixed by the re-read; one that stays empty is refused', async () => {
  mock.products = seven();
  let n = 0;
  mock.onSearch = (page) => {
    mock.emptyPage = page === 2 && n++ === 0 ? 2 : null;
  };
  try {
    const f = await fetchAllListings();
    assert.equal(f.read, 7);
    assert.equal(f.passes, 2);
    assert.equal(f.pages, 4);
    mock.onSearch = null;
    mock.emptyPage = 2;
    await assert.rejects(fetchAllListings(), (e) => e.kind === 'incomplete' && /page 2 of 4 came back empty/.test(e.message));
  } finally {
    mock.onSearch = null;
    mock.emptyPage = null;
  }
});

await step('a site that ignores the page number is refused, not compared (the "only the first page" failure)', async () => {
  resetState();
  mock.products = [L.asus, L.msi, L.lenovo, L.acer, L.hp];
  const n0 = mails();
  try {
    mock.ignorePage = true;
    const r = await runOnce({ now: at(0) });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'incomplete');
    assert.equal(mails(), n0);
    assert.equal(readState().baselineDone, false);
    assert.deepEqual(readState().listings, {});

    await runOnce({ now: at(50) }); // still failing after 45 minutes: the owner is told why
  } finally {
    mock.ignorePage = false;
  }
  assert.equal(mails(), n0 + 1);
  assert.match(last().subject, /can't read Best Buy \(incomplete\)/);
  assert.match(html(last()), /refuses to compare an incomplete list/);
});

await step('a laptop the site counts but never returns is a visible warning, not a failure', async () => {
  resetState();
  try {
    mock.products = many(9);
    mock.reportedTotal = 10;
    const r = await runOnce({ now: at(0) });
    assert.equal(r.ok, true);
    assert.deepEqual(r.coverage, { read: 9, total: 10, pages: 5 });
    assert.match(html(last()), /Checked 9 of 10 listings: 1 missing from this check/);

    mock.products = [...many(9), ...many(1, 9)];
    mock.reportedTotal = 11;
    const r2 = await runOnce({ now: at(5) });
    assert.equal(r2.kind, 'changes');
    assert.match(html(last()), /⚠ Checked 10 of 11 listings: 1 missing from this check/);
  } finally {
    mock.reportedTotal = null;
  }
});

await step('a result far below the site total is refused, never compared', async () => {
  resetState();
  const n0 = mails();
  try {
    mock.products = many(9);
    mock.reportedTotal = 20;
    const r = await runOnce({ now: at(0) });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'incomplete');
    assert.equal(mails(), n0);
  } finally {
    mock.reportedTotal = null;
  }
});

await step('a list longer than MAX_PAGES is an error, never silently cut short', async () => {
  mock.products = seven();
  const tooLong = (e) => e.kind === 'incomplete' && /MAX_PAGES/.test(e.message);
  await assert.rejects(fetchAllListings({ maxPages: 2 }), tooLong);
  try {
    mock.hideTotals = true;
    await assert.rejects(fetchAllListings({ maxPages: 2 }), tooLong);
  } finally {
    mock.hideTotals = false;
  }
  assert.equal((await fetchAllListings({ maxPages: 4 })).read, 7);
});

await step('a very long list stays below the size where Gmail cuts emails off; the CSV and text still carry every laptop', () => {
  const now = new Date('2026-10-28T03:00:00Z');
  const entries = many(300).map((p) => ({ ...normalizeProduct(p), firstSeenAt: now.toISOString(), missCount: 0 }));
  const none = { newListings: [], relisted: [], priceDrops: [], priceRises: [], restocks: [], soldOutOnline: [], removed: [], unchanged: 300 };
  const coverage = { read: 300, total: 300, pages: 13 };
  const stats = { before: { count: 299, cheapest: 810, median: 2200 }, after: { count: 300, cheapest: 800, median: 2250 } };

  const report = buildReport({ result: { ...none, baseline: false, newListings: [entries[0]] }, entries, stats, coverage, now });
  assert.ok(Buffer.byteLength(report.html) < 100_000, `html is ${Buffer.byteLength(report.html)} bytes`);
  assert.match(report.html, /more laptops are in the attached CSV/);
  assert.match(report.html, /Checked the complete list: 300 of 300 listings \(13 pages of results\)/);
  assert.match(report.text, /FULL LIST \(300\)/);
  assert.equal(report.text.split('\n').filter((l) => l.startsWith('[SAME')).length, 299);
  assert.equal(report.attachments[0].content.trim().split(/\r?\n/).length, 301);

  const first = buildReport({ result: { ...none, baseline: true, newListings: entries }, entries, stats, coverage, now });
  assert.ok(Buffer.byteLength(first.html) < 100_000, `baseline html is ${Buffer.byteLength(first.html)} bytes`);
  assert.match(first.html, /more laptops are in the attached CSV/);
  assert.equal(first.text.split('\n').filter((l) => l.startsWith('- $')).length, 300);
});

console.log('\ncommand line');
const root =path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = (...args) =>
  new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(root, 'src', 'index.js'), ...args],
      { env: process.env, timeout: 60_000 },
      (error, stdout, stderr) =>
        resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, out: `${stdout}${stderr}` }),
    );
  });

await step('--test-email sends a test message and exits 0', async () => {
  const n0 = mails();
  const r = await cli('--test-email');
  assert.equal(r.code, 0, r.out);
  assert.equal(mails(), n0 + 1);
  assert.match(last().subject, /Test email/);
});

await step('--preview writes the report to disk, sends nothing and saves nothing', async () => {
  resetState();
  mock.products = [L.asus, L.msi];
  const n0 = mails();
  const r = await cli('--preview');
  assert.equal(r.code, 0, r.out);
  assert.equal(mails(), n0);
  assert.ok(fs.existsSync(path.join(tmp, 'out', 'report.html')));
  assert.ok(fs.existsSync(path.join(tmp, 'out', 'comparison.csv')));
  assert.equal(fs.existsSync(stateFile), false);
});

await step('--dump-raw saves the first raw products so field names can be checked', async () => {
  resetState();
  const r = await cli('--dump-raw');
  assert.equal(r.code, 0, r.out);
  const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'out', 'raw-sample.json'), 'utf8'));
  assert.equal(raw[0].sku, L.asus.sku);
});

await step('exit code 1 when a new laptop cannot be emailed (GitHub then flags the run); recipient is never printed', async () => {
  mock.products = [...mock.products, L.razer];
  sink.refuse = true;
  const r = await cli();
  sink.refuse = false;
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Could not send email/);
  assert.ok(!r.out.includes('me@example.test'), 'recipient must not appear in logs');
  const r2 = await cli();
  assert.equal(r2.code, 0, r2.out);
  assert.match(last().subject, /Razer Blade 14/);
});

closeTransport();
await mock.close();
await sink.close();
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
