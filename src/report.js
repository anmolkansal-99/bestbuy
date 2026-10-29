import { config } from './config.js';
import { esc, money, plural, fmtDateTime } from './util.js';

const C = {
  ink: '#0f172a',
  muted: '#64748b',
  line: '#e2e8f0',
  page: '#eef2f7',
  card: '#ffffff',
  soft: '#f8fafc',
  accent: '#facc15',
  green: '#166534',
  greenBg: '#dcfce7',
  blue: '#1e40af',
  blueBg: '#dbeafe',
  purple: '#5b21b6',
  purpleBg: '#ede9fe',
  amber: '#92400e',
  amberBg: '#fef3c7',
  red: '#991b1b',
  redBg: '#fee2e2',
  grey: '#334155',
  greyBg: '#e2e8f0',
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : config.pageUrl);
const byPrice = (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity);
/** Title without the trailing "(CPU/RAM/SSD/GPU)" block, cut at a word boundary. */
const shortName = (name) => {
  const base = String(name).replace(/\s*\([^()]*\/[^()]*\)\s*$/, '').trim();
  if (base.length <= 80) return base;
  const cut = base.slice(0, 79);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 50 ? space : 79)}…`;
};
const stamp = (now) => `${fmtDateTime(now, config.reportTz)}  ·  ${fmtDateTime(now, config.storeTz)}`;

// ---------------------------------------------------------------------------------------------
// small HTML helpers (inline styles only: email clients ignore <style> blocks)
// ---------------------------------------------------------------------------------------------

function badge(text, fg, bg) {
  return `<span style="display:inline-block;padding:2px 8px;margin:0 4px 4px 0;border-radius:999px;background:${bg};color:${fg};font:700 11px/16px ${FONT};letter-spacing:.3px;text-transform:uppercase;">${esc(text)}</span>`;
}

function detailRows(rows) {
  const body = rows
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(
      ([k, v]) =>
        `<tr><td style="padding:3px 12px 3px 0;font:600 12px/18px ${FONT};color:${C.muted};white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:3px 0;font:400 13px/18px ${FONT};color:${C.ink};">${esc(v)}</td></tr>`,
    )
    .join('');
  return body ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${body}</table>` : '';
}

function section(title, count) {
  return `<tr><td style="padding:24px 24px 10px 24px;font:700 17px/24px ${FONT};color:${C.ink};">${title} <span style="color:${C.muted};font-weight:600;">(${count})</span></td></tr>`;
}

function itemBadges(item, extra) {
  return [
    extra,
    item.condition && badge(item.condition, C.grey, C.greyBg),
    item.flags?.storeOnly && badge('In-store only', C.amber, C.amberBg),
    item.flags?.onlineOnly && badge('Online only', C.blue, C.blueBg),
    item.flags?.clearance && badge('Clearance', C.red, C.redBg),
  ]
    .filter(Boolean)
    .join('');
}

function priceHtml(item, was) {
  const compareAt = was ?? (item.regularPrice > item.price ? item.regularPrice : null);
  const save = compareAt && compareAt > item.price ? compareAt - item.price : 0;
  const pct = save ? Math.round((save / compareAt) * 100) : 0;
  let html = `<span style="font:700 24px/30px ${FONT};color:${C.ink};">${money(item.price)}</span>`;
  if (save > 0) {
    html += ` <span style="font:400 14px/20px ${FONT};color:${C.muted};text-decoration:line-through;">${money(compareAt)}</span>`;
    html += ` <span style="font:700 13px/20px ${FONT};color:${C.green};">${was ? 'Dropped' : 'Save'} ${money(save)} (${pct}%)</span>`;
  }
  return html;
}

/** Compact price for list rows: current price, with the regular price struck through underneath. */
function priceStack(item) {
  const was =
    item.regularPrice > item.price
      ? `<br><span style="font:400 12px/16px ${FONT};color:${C.muted};text-decoration:line-through;">${money(item.regularPrice)}</span>`
      : '';
  return `<strong style="font:700 16px/22px ${FONT};color:${C.ink};">${money(item.price)}</strong>${was}`;
}

function image(item, size) {
  if (!item.image) {
    return `<div style="width:${size}px;height:${Math.round(size * 0.75)}px;background:${C.soft};border:1px solid ${C.line};border-radius:6px;"></div>`;
  }
  return `<a href="${esc(safeUrl(item.url))}"><img src="${esc(item.image)}" width="${size}" alt="" style="display:block;border:0;border-radius:6px;max-width:${size}px;height:auto;"></a>`;
}

/** Full-detail card, used for new listings. */
function card(item, { tag, details, was } = {}) {
  const url = safeUrl(item.url);
  const s = item.specs ?? {};
  const d = details?.[item.sku];

  const rows = [
    ['Condition', item.condition ?? 'Open box / refurbished'],
    ['Brand / model', [item.brand, item.model].filter(Boolean).join('  ·  ') || null],
    ['SKU', item.sku],
    ['Screen', [s.screen, s.refresh].filter(Boolean).join('  ·  ') || null],
    ['CPU', s.cpu],
    ['GPU', s.gpu],
    ['Memory', s.ram],
    ['Storage', s.storage],
    ['Rating', item.rating ? `${item.rating.toFixed(1)} / 5  (${item.ratingCount} ${plural(item.ratingCount, 'review')})` : 'No reviews yet'],
    ['Sold by', item.seller ?? (item.flags?.marketplace ? 'Marketplace seller' : 'Best Buy')],
    ['Availability', item.availabilityText],
    ['Sale ends', item.saleEndDate ? fmtDateTime(item.saleEndDate, config.storeTz) : null],
    ['First seen', fmtDateTime(item.firstSeenAt, config.reportTz)],
  ];

  const highlights = d?.highlights?.length
    ? `<ul style="margin:10px 0 0 18px;padding:0;font:400 13px/19px ${FONT};color:${C.ink};">${d.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`
    : '';
  const description = d?.description
    ? `<div style="margin-top:10px;font:400 13px/19px ${FONT};color:${C.grey};">${esc(d.description)}</div>`
    : '';
  const fullSpecs = d?.specs?.length
    ? `<div style="margin:12px 0 4px 0;font:700 11px/16px ${FONT};color:${C.muted};text-transform:uppercase;letter-spacing:.6px;">Full specifications</div>${detailRows(d.specs)}`
    : '';

  return `<tr><td style="padding:0 20px 14px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:10px;border-collapse:separate;background:${C.card};">
<tr>
<td width="128" valign="top" style="padding:14px 8px 8px 14px;">${image(item, 108)}</td>
<td valign="top" style="padding:14px 14px 8px 6px;">
<div>${itemBadges(item, tag)}</div>
<a href="${esc(url)}" style="font:700 15px/21px ${FONT};color:${C.ink};text-decoration:none;">${esc(item.name)}</a>
<div style="margin-top:8px;">${priceHtml(item, was)}</div>
</td>
</tr>
<tr><td colspan="2" style="padding:4px 14px 14px 14px;">
${detailRows(rows)}${highlights}${description}${fullSpecs}
<div style="margin-top:14px;"><a href="${esc(url)}" style="display:inline-block;background:${C.accent};color:${C.ink};font:700 14px/20px ${FONT};text-decoration:none;padding:10px 18px;border-radius:8px;">View &amp; buy on bestbuy.ca &rarr;</a></div>
</td></tr>
</table>
</td></tr>`;
}

/** One line per laptop, for lists. */
function compactRow(item, { right, note } = {}) {
  const url = safeUrl(item.url);
  return `<tr>
<td width="60" valign="top" style="padding:10px 8px 10px 0;border-top:1px solid ${C.line};">${item.image ? image(item, 48) : ''}</td>
<td valign="top" style="padding:10px 8px 10px 0;border-top:1px solid ${C.line};">
<a href="${esc(url)}" style="font:600 14px/20px ${FONT};color:${C.ink};text-decoration:none;">${esc(shortName(item.name))}</a>
${note ? `<div style="font:400 12px/18px ${FONT};color:${C.grey};">${note}</div>` : ''}
<div style="font:400 12px/18px ${FONT};color:${C.muted};">${esc(item.condition ?? 'Open box / refurbished')}  ·  SKU ${esc(item.sku)}</div>
</td>
<td align="right" valign="top" style="padding:10px 0;border-top:1px solid ${C.line};white-space:nowrap;font:400 13px/20px ${FONT};color:${C.ink};">${right}</td>
</tr>`;
}

const listBlock = (rows) =>
  `<tr><td style="padding:0 24px 8px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table></td></tr>`;

function header(title, subtitle) {
  return `<tr><td style="background:${C.ink};border-radius:12px 12px 0 0;padding:22px 24px;">
<div style="font:700 11px/16px ${FONT};letter-spacing:1px;text-transform:uppercase;color:${C.accent};">Best Buy Canada &middot; Gaming laptops &middot; Open box &amp; refurbished</div>
<div style="font:700 22px/28px ${FONT};color:#ffffff;margin-top:6px;">${esc(title)}</div>
<div style="font:400 13px/18px ${FONT};color:#cbd5e1;margin-top:4px;">${esc(subtitle)}</div>
</td></tr>`;
}

function statStrip(cells) {
  const td = ([label, n, fg, bg]) =>
    `<td align="center" style="background:${bg};border-radius:8px;padding:10px 4px;"><div style="font:700 22px/26px ${FONT};color:${fg};">${n}</div><div style="font:600 10px/14px ${FONT};color:${fg};text-transform:uppercase;letter-spacing:.5px;">${esc(label)}</div></td>`;
  return `<tr><td style="padding:18px 18px 0 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="6" border="0"><tr>${cells.map(td).join('')}</tr></table></td></tr>`;
}

/** How much of the site's list we really read. This is what makes the comparison trustworthy. */
function coverageText(coverage) {
  if (!coverage) return null;
  const { read, total, pages } = coverage;
  const pg = `${pages} ${plural(pages, 'page')} of results`;
  if (total === null || total === undefined) {
    return { ok: true, text: `Read ${read} listings (${pg}); the site did not say how many there should be` };
  }
  // read > total happens when a laptop was added while the list was being read; that is still the complete list.
  if (read >= total) return { ok: true, text: `Checked the complete list: ${read === total ? `${read} of ${total}` : read} listings (${pg})` };
  return { ok: false, text: `Checked ${read} of ${total} listings: ${total - read} missing from this check (${pg})` };
}

const coverageRow = (coverage) => {
  const c = coverageText(coverage);
  if (!c) return '';
  return `<tr><td colspan="3" style="padding:8px 0 0 0;border-top:1px solid ${C.line};font:600 12px/18px ${FONT};color:${c.ok ? C.green : C.amber};">${c.ok ? '✓' : '⚠'} ${esc(c.text)}</td></tr>`;
};

function comparePanel(stats, coverage) {
  const row = (label, a, b) =>
    `<tr><td style="padding:6px 0;border-top:1px solid ${C.line};font:600 12px/18px ${FONT};color:${C.muted};">${label}</td><td align="right" style="padding:6px 0;border-top:1px solid ${C.line};font:400 13px/18px ${FONT};color:${C.grey};">${a}</td><td align="right" style="padding:6px 0 6px 12px;border-top:1px solid ${C.line};font:700 13px/18px ${FONT};color:${C.ink};">${b}</td></tr>`;
  const { before, after } = stats;
  return `<tr><td style="padding:18px 24px 0 24px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding-bottom:6px;font:700 11px/16px ${FONT};color:${C.muted};text-transform:uppercase;letter-spacing:.6px;">Old vs new</td><td align="right" style="font:700 11px/16px ${FONT};color:${C.muted};text-transform:uppercase;">Previous check</td><td align="right" style="padding-left:12px;font:700 11px/16px ${FONT};color:${C.muted};text-transform:uppercase;">Now</td></tr>
${row('Laptops listed', before.count, after.count)}
${row('Cheapest', money(before.cheapest), money(after.cheapest))}
${row('Median price', money(before.median), money(after.median))}
${coverageRow(coverage)}
</table></td></tr>`;
}

function shell({ title, preheader, body }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};"><tr><td align="center" style="padding:16px 8px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:${C.card};border-radius:12px;font-family:${FONT};color:${C.ink};">
${body}
</table>
</td></tr></table>
</body></html>`;
}

function footer(now, extra = '') {
  return `<tr><td style="padding:22px 24px 26px 24px;border-top:1px solid ${C.line};font:400 12px/18px ${FONT};color:${C.muted};">
<a href="${esc(config.pageUrl)}" style="color:${C.blue};font-weight:700;">Open the live listing on bestbuy.ca</a><br>
Open-box and refurbished units are one-offs. They can sell out within minutes, so check out fast.<br>
${extra}Checked ${esc(stamp(now))}
</td></tr>`;
}

// ---------------------------------------------------------------------------------------------
// subject, status table, CSV
// ---------------------------------------------------------------------------------------------

function buildSubject(result, entries) {
  const p = config.mail.subjectPrefix;
  if (result.baseline) return `${p} Monitor started: tracking ${entries.length} ${plural(entries.length, 'laptop')}`;

  const fresh = [...result.newListings, ...result.relisted];
  const others = result.priceDrops.length + result.restocks.length;
  if (fresh.length === 1 && others === 0) {
    const it = fresh[0];
    return `${p} 🆕 ${money(it.price)} · ${shortName(it.name)}${it.condition ? ` (${it.condition})` : ''}`;
  }
  const bits = [];
  if (fresh.length) {
    const cheapest = Math.min(...fresh.map((i) => i.price).filter(Number.isFinite));
    bits.push(`🆕 ${fresh.length} new ${plural(fresh.length, 'laptop')}${Number.isFinite(cheapest) ? ` from ${money(cheapest)}` : ''}`);
  }
  if (result.priceDrops.length) bits.push(`💸 ${result.priceDrops.length} price ${plural(result.priceDrops.length, 'drop')}`);
  if (result.restocks.length) bits.push(`✅ ${result.restocks.length} back in stock`);
  if (!bits.length && result.priceRises.length) bits.push(`${result.priceRises.length} price ${plural(result.priceRises.length, 'increase')}`);
  if (!bits.length && result.removed.length) bits.push(`${result.removed.length} ${plural(result.removed.length, 'listing')} gone`);
  return `${p} ${bits.join(' · ')}`;
}

function statusMap(result) {
  const m = new Map();
  const mark = (sku, status, prev = '') => m.set(sku, { status, prev });
  if (result.baseline) {
    for (const i of result.newListings) mark(i.sku, 'BASELINE');
    return m;
  }
  for (const i of result.newListings) mark(i.sku, 'NEW');
  for (const i of result.relisted) mark(i.sku, 'BACK_ON_LIST');
  for (const c of result.priceDrops) mark(c.item.sku, 'PRICE_DROP', c.oldPrice);
  for (const c of result.priceRises) mark(c.item.sku, 'PRICE_UP', c.oldPrice);
  for (const c of result.restocks) mark(c.item.sku, 'BACK_IN_STOCK');
  for (const c of result.soldOutOnline) mark(c.item.sku, 'SOLD_OUT_ONLINE');
  return m;
}

const csvCell = (v, text = false) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (text && /^[=+@\-]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function buildCsv(result, entries) {
  const status = statusMap(result);
  const head = ['status', 'sku', 'name', 'condition', 'brand', 'price_cad', 'regular_price_cad', 'previous_price_cad', 'rating', 'rating_count', 'availability', 'seller', 'first_seen_utc', 'url'];
  const line = (i, st, prev = '') =>
    [
      csvCell(st),
      csvCell(i.sku),
      csvCell(i.name, true),
      csvCell(i.condition, true),
      csvCell(i.brand, true),
      csvCell(i.price),
      csvCell(i.regularPrice),
      csvCell(prev),
      csvCell(i.rating),
      csvCell(i.ratingCount),
      csvCell(i.availabilityText, true),
      csvCell(i.seller, true),
      csvCell(i.firstSeenAt),
      csvCell(i.url),
    ].join(',');
  const rows = [...entries].sort(byPrice).map((i) => {
    const s = status.get(i.sku);
    return line(i, s?.status ?? 'UNCHANGED', s?.prev ?? '');
  });
  for (const i of result.removed) rows.push(line(i, 'REMOVED'));
  return `﻿${head.join(',')}\r\n${rows.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------------------------
// the main report
// ---------------------------------------------------------------------------------------------

// Gmail cuts off ("clips") emails whose HTML is bigger than ~102 KB, so long lists are trimmed to fit this budget.
// Nothing is lost: the attached CSV and the plain-text part always carry every laptop.
const HTML_BUDGET = 90_000;
const bytes = (s) => Buffer.byteLength(s);

/** Render rows while the email stays under the budget (`body` is what has been written so far). */
function fitRows(body, rows, render, reserve = 3_000) {
  let used = body.reduce((n, s) => n + bytes(s), reserve);
  const out = [];
  for (const row of rows) {
    const html = render(row);
    used += bytes(html);
    if (used > HTML_BUDGET) break;
    out.push(html);
  }
  return out;
}

const CHIPS = {
  NEW: ['New', C.green, C.greenBg],
  BACK_ON_LIST: ['Back', C.green, C.greenBg],
  PRICE_DROP: ['Drop', C.blue, C.blueBg],
  PRICE_UP: ['Up', C.amber, C.amberBg],
  BACK_IN_STOCK: ['Restock', C.purple, C.purpleBg],
  SOLD_OUT_ONLINE: ['Sold out', C.red, C.redBg],
  UNCHANGED: ['Same', C.muted, C.soft],
  REMOVED: ['Gone', C.muted, C.greyBg],
};
const TEXT_TAG = { NEW: 'NEW', BACK_ON_LIST: 'BACK', PRICE_DROP: 'DROP', PRICE_UP: 'UP', BACK_IN_STOCK: 'RESTOCK', SOLD_OUT_ONLINE: 'SOLD OUT', UNCHANGED: 'SAME', REMOVED: 'GONE' };
const LEAN_FONT = 'Arial,Helvetica,sans-serif';

/** Every laptop currently listed (plus the ones that just left) with its old-vs-new status. */
function fullListRows(result, entries) {
  const status = statusMap(result);
  const rows = [...entries].sort(byPrice).map((item) => ({ item, ...(status.get(item.sku) ?? { status: 'UNCHANGED', prev: '' }) }));
  for (const item of result.removed) rows.push({ item, status: 'REMOVED', prev: '' });
  return rows;
}

function leanRow({ item, status, prev }) {
  const [label, fg, bg] = CHIPS[status] ?? CHIPS.UNCHANGED;
  const td = `padding:6px 8px 6px 0;border-top:1px solid ${C.line};font:13px/18px ${LEAN_FONT};color:${status === 'UNCHANGED' || status === 'REMOVED' ? C.grey : C.ink};`;
  const price = prev ? `<s style="color:${C.muted};">${money(prev)}</s> <b>${money(item.price)}</b>` : money(item.price);
  return `<tr><td width="60" valign="top" style="${td}"><span style="display:inline-block;padding:1px 7px;border-radius:999px;background:${bg};color:${fg};font:700 10px/16px ${LEAN_FONT};text-transform:uppercase;">${label}</span></td><td valign="top" style="${td}"><a href="${esc(safeUrl(item.url))}" style="color:inherit;text-decoration:none;">${esc(shortName(item.name))}</a></td><td align="right" valign="top" style="${td}padding-right:0;white-space:nowrap;">${price}</td></tr>`;
}

const textRow = ({ item, status, prev }) =>
  `[${(TEXT_TAG[status] ?? 'SAME').padEnd(7)}] ${money(item.price).padStart(10)}  ${shortName(item.name)}${prev ? `  (was ${money(prev)})` : ''}`;

const moreLine = (n, shown) =>
  `<tr><td style="padding:2px 24px 10px 24px;font:400 12px/18px ${FONT};color:${C.muted};">${shown ? `+${n} more laptops are in the attached CSV.` : 'The full list is in the attached CSV.'} (This email is kept short so Gmail does not cut it off.)</td></tr>`;

function sanityLine(entries, coverage) {
  const counts = {};
  for (const e of entries) counts[e.condition ?? 'Unlabelled'] = (counts[e.condition ?? 'Unlabelled'] ?? 0) + 1;
  const prices = entries.map((e) => e.price).filter(Number.isFinite);
  const range = prices.length ? `${money(Math.min(...prices))} to ${money(Math.max(...prices))}` : 'n/a';
  const mix = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ');
  const c = coverageText(coverage);
  const cov = c ? ` ${c.text}.${coverage.total !== null && coverage.total !== undefined ? ` The website should show ${coverage.total} items.` : ''}` : '';
  return `Sanity check: ${mix}. Prices ${range} (your filter is $200 to $1,950).${cov}`;
}

export function buildReport({ result, entries, stats, coverage = null, now, details = {} }) {
  const subject = buildSubject(result, entries);
  const fresh = [...result.newListings, ...result.relisted].sort(byPrice);
  const relisted = new Set(result.relisted.map((i) => i.sku));
  const sortedEntries = [...entries].sort(byPrice);

  const body = [];
  const text = [];

  if (result.baseline) {
    const title = `Monitor started. Tracking ${entries.length} ${plural(entries.length, 'laptop')}`;
    body.push(header(title, `From now on you only get an email when something changes. First check: ${stamp(now)}`));
    body.push(`<tr><td style="padding:18px 24px 0 24px;font:400 13px/20px ${FONT};color:${C.grey};">This is the starting snapshot, sorted cheapest first. It also confirms that email delivery works. ${esc(sanityLine(entries, coverage))}</td></tr>`);
    body.push(section('Currently listed', entries.length));
    const listed = fitRows(body, sortedEntries, (i) => compactRow(i, { right: priceStack(i) }));
    if (listed.length) body.push(listBlock(listed));
    if (listed.length < sortedEntries.length) body.push(moreLine(sortedEntries.length - listed.length, listed.length));
    text.push(title, '', `Starting snapshot (cheapest first). ${sanityLine(entries, coverage)}`, '');
    for (const i of sortedEntries) text.push(`- ${money(i.price)}  ${i.name} [${i.condition ?? 'open box/refurb'}]`, `  ${i.url}`);
  } else {
    const parts = [];
    if (fresh.length) parts.push(`${fresh.length} new`);
    if (result.priceDrops.length) parts.push(`${result.priceDrops.length} price ${plural(result.priceDrops.length, 'drop')}`);
    if (result.restocks.length) parts.push(`${result.restocks.length} back in stock`);
    const title = parts.length ? `${parts.join(' · ')}` : 'Listing changes';
    body.push(header(title, `Compared with the previous check. ${stamp(now)}`));
    body.push(
      statStrip([
        ['New', fresh.length, C.green, C.greenBg],
        ['Price drops', result.priceDrops.length, C.blue, C.blueBg],
        ['Back in stock', result.restocks.length, C.purple, C.purpleBg],
        ['Removed', result.removed.length, C.grey, C.greyBg],
      ]),
    );
    body.push(comparePanel(stats, coverage));
    text.push(title, `Compared with the previous check. ${stamp(now)}`, '', `Laptops listed: ${stats.before.count} -> ${stats.after.count}`, `Cheapest: ${money(stats.before.cheapest)} -> ${money(stats.after.cheapest)}`, coverageText(coverage)?.text ?? '', '');

    if (fresh.length) {
      body.push(section('🆕 New laptops', fresh.length));
      const cards = fresh.slice(0, config.maxDetailedCards);
      for (const i of cards) body.push(card(i, { tag: badge(relisted.has(i.sku) ? 'Back on the list' : 'New', C.green, C.greenBg), details }));
      const rest = fresh.slice(config.maxDetailedCards);
      if (rest.length) body.push(listBlock(rest.map((i) => compactRow(i, { right: priceStack(i) }))));
      text.push(`NEW LAPTOPS (${fresh.length})`, '');
      for (const i of fresh) {
        const s = i.specs ?? {};
        text.push(
          `* ${i.name}`,
          `  ${money(i.price)}${i.regularPrice > i.price ? `  (was ${money(i.regularPrice)})` : ''}  |  ${i.condition ?? 'open box/refurb'}  |  SKU ${i.sku}`,
          ...[s.cpu, s.gpu, s.ram, s.storage].filter(Boolean).map((v) => `  ${v}`),
          i.availabilityText ? `  ${i.availabilityText}` : '',
          `  ${i.url}`,
          '',
        );
      }
    }

    if (result.priceDrops.length) {
      body.push(section('💸 Price drops', result.priceDrops.length));
      body.push(
        listBlock(
          [...result.priceDrops]
            .sort((a, b) => b.percent - a.percent)
            .map((c) =>
              compactRow(c.item, {
                note: `<span style="color:${C.green};font-weight:700;">Down ${money(c.amount)} (${Math.round(c.percent)}%)</span>`,
                right: `<span style="color:${C.muted};text-decoration:line-through;">${money(c.oldPrice)}</span><br><strong style="font-size:16px;">${money(c.newPrice)}</strong>`,
              }),
            ),
        ),
      );
      text.push(`PRICE DROPS (${result.priceDrops.length})`, '');
      for (const c of result.priceDrops) text.push(`* ${c.item.name}`, `  ${money(c.oldPrice)} -> ${money(c.newPrice)}  (-${Math.round(c.percent)}%)`, `  ${c.item.url}`, '');
    }

    if (result.restocks.length) {
      body.push(section('✅ Back in stock', result.restocks.length));
      body.push(listBlock(result.restocks.map((c) => compactRow(c.item, { note: esc(c.item.availabilityText ?? ''), right: `<strong style="font-size:16px;">${money(c.item.price)}</strong>` }))));
      text.push(`BACK IN STOCK (${result.restocks.length})`, '');
      for (const c of result.restocks) text.push(`* ${c.item.name}  ${money(c.item.price)}`, `  ${c.item.url}`, '');
    }

    if (result.priceRises.length) {
      body.push(section('Price increases', result.priceRises.length));
      body.push(listBlock(result.priceRises.map((c) => compactRow(c.item, { right: `<span style="color:${C.muted};text-decoration:line-through;">${money(c.oldPrice)}</span><br>${money(c.newPrice)}` }))));
      text.push(`PRICE INCREASES (${result.priceRises.length})`, ...result.priceRises.map((c) => `* ${c.item.name}  ${money(c.oldPrice)} -> ${money(c.newPrice)}`), '');
    }

    if (result.removed.length) {
      body.push(section('Gone from the listing (sold or removed)', result.removed.length));
      body.push(listBlock(result.removed.map((i) => compactRow(i, { right: `<span style="color:${C.muted};">${money(i.price)}</span>` }))));
      text.push(`GONE FROM THE LISTING (${result.removed.length})`, ...result.removed.map((i) => `* ${i.name}  (last price ${money(i.price)})`), '');
    }

    // The complete old-vs-new list: every laptop on the site right now, plus the ones that just left.
    const rows = fullListRows(result, entries);
    const listedLabel = `${entries.length}${result.removed.length ? ` + ${result.removed.length} gone` : ''}`;
    body.push(section('Full list: every laptop, old vs new', listedLabel));
    body.push(`<tr><td style="padding:0 24px 6px 24px;font:400 12px/18px ${FONT};color:${C.muted};">Cheapest first. <b>Same</b> means unchanged since the previous check.</td></tr>`);
    const shown = fitRows(body, rows, leanRow);
    if (shown.length) body.push(listBlock(shown));
    if (shown.length < rows.length) body.push(moreLine(rows.length - shown.length, shown.length));
    text.push(`FULL LIST (${listedLabel}), cheapest first`, ...rows.map(textRow), '');
  }

  body.push(footer(now, 'The attached CSV compares every current laptop with the previous check.<br>'));
  text.push('', `Live listing: ${config.pageUrl}`, 'Open-box units sell out fast. The attached CSV has the full comparison.', `Checked ${stamp(now)}`);

  const preheader = fresh[0]
    ? `${money(fresh[0].price)} · ${shortName(fresh[0].name)}`
    : result.priceDrops[0]
      ? `${money(result.priceDrops[0].item.price)} · ${shortName(result.priceDrops[0].item.name)}`
      : `${entries.length} laptops tracked`;

  return {
    subject,
    html: shell({ title: subject, preheader, body: body.join('\n') }),
    text: text.filter((l) => l !== undefined).join('\n'),
    attachments: [
      {
        filename: `comparison-${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`,
        content: buildCsv(result, entries),
        contentType: 'text/csv; charset=utf-8',
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// service emails
// ---------------------------------------------------------------------------------------------

function simpleEmail({ subject, title, subtitle, paragraphs, now }) {
  const body = [
    header(title, subtitle),
    ...paragraphs.map((p) => `<tr><td style="padding:16px 24px 0 24px;font:400 14px/21px ${FONT};color:${C.ink};">${p}</td></tr>`),
    footer(now),
  ].join('\n');
  return { html: shell({ title: subject, preheader: subtitle, body }), subject };
}

const actionsLink = () => {
  const repo = process.env.GITHUB_REPOSITORY;
  const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
  return repo ? `<a href="${esc(`${server}/${repo}/actions`)}">the Actions log</a>` : 'the run log';
};

export function buildFailureEmail({ outage, error, now, downMinutes }) {
  const subject = `${config.mail.subjectPrefix} ⚠️ Monitor can't read Best Buy (${outage.error})`;
  const hours = downMinutes >= 90 ? `${(downMinutes / 60).toFixed(1)} hours` : `${Math.round(downMinutes)} minutes`;
  const blocked = /^blocked/.test(outage.error);
  const partial = /^incomplete/.test(outage.error);
  const { html } = simpleEmail({
    subject,
    title: "The monitor can't read Best Buy right now",
    subtitle: `Failing for about ${hours}. Last error: ${outage.error}`,
    now,
    paragraphs: [
      `Since ${esc(fmtDateTime(outage.since, config.reportTz))} every check has failed, so <strong>new laptops are not being detected</strong> until this clears.`,
      `<strong>Error:</strong> ${esc(error?.message ?? outage.error)}`,
      blocked
        ? "Best Buy's bot protection is refusing requests from this server. This often happens to cloud IP addresses. Options: run the monitor from a home computer or Raspberry Pi (<code>npm run watch</code>), or from a different host, or route it through a proxy. See the README, section <em>If Best Buy blocks the server</em>."
        : partial
          ? 'The site returned only part of the list (not every "Show more" page loaded), so the monitor refuses to compare an incomplete list rather than risk wrong results. This is usually temporary. If it keeps happening, see the README, section <em>Checking the data</em>.'
          : 'This is usually temporary (site maintenance, network hiccup). The monitor keeps trying every few minutes and will email you when it recovers.',
      `Details are in ${actionsLink()}. You will get one reminder per day while this lasts.`,
    ],
  });
  return {
    subject,
    html,
    text: `The monitor can't read Best Buy right now.\nFailing since ${fmtDateTime(outage.since, config.reportTz)} (${outage.error}).\n${error?.message ?? ''}\nNew laptops are NOT being detected until this clears.`,
  };
}

export function buildRecoveryEmail({ outage, now, count }) {
  const subject = `${config.mail.subjectPrefix} ✅ Monitor is reading Best Buy again`;
  const { html } = simpleEmail({
    subject,
    title: 'Back online',
    subtitle: `Tracking ${count} ${plural(count, 'laptop')} again`,
    now,
    paragraphs: [
      `The outage that began ${esc(fmtDateTime(outage.since, config.reportTz))} (${esc(outage.error)}) is over. Anything that appeared while it lasted will show up as <em>new</em> in the next report, if it is still listed.`,
    ],
  });
  return { subject, html, text: `Back online. Tracking ${count} laptops again. The outage began ${fmtDateTime(outage.since, config.reportTz)} (${outage.error}).` };
}

export function buildTestEmail({ now }) {
  const subject = `${config.mail.subjectPrefix} Test email: delivery works`;
  const { html } = simpleEmail({
    subject,
    title: 'Test email',
    subtitle: 'Your Best Buy monitor can send mail',
    now,
    paragraphs: [
      'If you can read this, SMTP is configured correctly.',
      `The monitor watches <a href="${esc(config.pageUrl)}">this listing</a> and emails you when a new laptop appears, a price drops, or something comes back in stock.`,
    ],
  });
  return { subject, html, text: `Test email: delivery works.\nWatching: ${config.pageUrl}` };
}
