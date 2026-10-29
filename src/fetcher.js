import { config } from './config.js';
import { sleep, jitter, toNum } from './util.js';

export class FetchError extends Error {
  /** kind: blocked | http | network | bad_json | bad_shape | incomplete */
  constructor(kind, message, status = null) {
    super(message);
    this.name = 'FetchError';
    this.kind = kind;
    this.status = status;
  }
  get label() {
    return this.status ? `${this.kind}:${this.status}` : this.kind;
  }
}

const browserHeaders = () => ({
  'user-agent': config.userAgent,
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-CA,en;q=0.9',
  referer: config.pageUrl,
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
});

/**
 * The category page keeps its filters in a `path=` parameter. The site's own front end forwards that
 * value to the JSON API untouched, so we copy the raw (still percent-encoded) value from PAGE_URL.
 */
export function deriveQuery(pageUrl = config.pageUrl) {
  const u = new URL(pageUrl);
  const categoryId = u.pathname.match(/\/category\/[^/]+\/(\d+)/)?.[1] ?? null;
  const rawPath =
    u.search
      .replace(/^\?/, '')
      .split('&')
      .find((kv) => kv.startsWith('path='))
      ?.slice('path='.length) ?? '';
  return { categoryId, rawPath };
}

function setRawParam(url, key, value) {
  const re = new RegExp(`([?&])${key}=[^&]*`);
  if (re.test(url)) return url.replace(re, `$1${key}=${value}`);
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${value}`;
}

export function buildSearchUrl(page, pageSize = config.pageSize) {
  if (config.apiUrlOverride) {
    return setRawParam(setRawParam(config.apiUrlOverride, 'page', page), 'pageSize', pageSize);
  }
  const { categoryId, rawPath } = deriveQuery();
  if (!categoryId) {
    throw new FetchError('bad_shape', 'PAGE_URL has no /category/<name>/<id> part, so the category id is unknown');
  }
  const q = [
    `categoryid=${categoryId}`,
    `currentRegion=${config.region}`,
    `lang=${config.lang}`,
    `page=${page}`,
    `pageSize=${pageSize}`,
  ];
  if (rawPath) q.push(`path=${rawPath}`);
  q.push('query=', 'sortBy=relevance', 'sortDir=desc');
  return `${config.apiBase}/api/v2/json/search?${q.join('&')}`;
}

export function buildDetailUrl(sku) {
  return `${config.apiBase}/api/v2/json/product/${encodeURIComponent(sku)}?currentRegion=${config.region}&lang=${config.lang}`;
}

async function requestJson(url, { attempts = config.retries } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: browserHeaders(),
        redirect: 'follow',
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
      const text = await res.text();

      if (res.status === 403 || res.status === 429) {
        throw new FetchError('blocked', `HTTP ${res.status} - the site refused the request (bot protection or rate limit)`, res.status);
      }
      if (!res.ok) {
        throw new FetchError('http', `HTTP ${res.status}`, res.status);
      }
      const head = text.trimStart();
      if (!head.startsWith('{') && !head.startsWith('[')) {
        throw new FetchError('blocked', 'Got a web page instead of JSON (probably a bot-protection challenge)', res.status);
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new FetchError('bad_json', 'Response was not valid JSON', res.status);
      }
    } catch (err) {
      const e = err instanceof FetchError ? err : new FetchError('network', `${err.name}: ${err.message}`);
      lastError = e;
      // Being blocked is not fixed by hammering: one retry at most.
      const giveUp = attempt >= attempts || (e.kind === 'blocked' && attempt >= 2) || e.kind === 'bad_shape';
      if (giveUp) break;
      await sleep(config.retryBaseMs * attempt * (e.kind === 'blocked' ? 4 : 1) + jitter(0, 500));
    }
  }
  throw lastError;
}

async function fetchSearchPage(page) {
  const data = await requestJson(buildSearchUrl(page));
  if (!data || typeof data !== 'object' || !Array.isArray(data.products)) {
    throw new FetchError('bad_shape', 'Response has no "products" list (the API may have changed)');
  }
  return data;
}

/**
 * Read the WHOLE filtered list: everything you would see after pressing "Show more" until the button
 * disappears. That button just asks the same JSON API for the next `page`, so we walk the pages the same way.
 *
 * Why the result can be trusted:
 *  1. The walk is driven by the site's own numbers (`totalPages`, `total`), never by guesses about page size,
 *     and it has no silent cut-off: a list longer than MAX_PAGES is an error, not a truncation.
 *  2. A pass is "clean" only if every page loaded, none was empty or a repeat before the end, the site's total
 *     did not change while we were reading (a laptop sold or added mid-read shifts later pages by one, so an item
 *     can slip through) and we ended up with all `total` listings. A pass that is not clean is repeated once and
 *     the two reads are merged.
 *  3. All or nothing: a page that cannot be loaded, a site that ignores the page number, or a result that is
 *     clearly smaller than the site's own total all throw `incomplete`, so a half-read list is never compared with
 *     the saved snapshot (which would invent "removed" and "new" laptops).
 *
 * Returns { raw, read, totalReported, pages, passes, warnings }. `totalReported` is null when the site does not say.
 */
export async function fetchAllListings({ maxPages = config.maxPages, passes = 2 } = {}) {
  const pageLimit = Math.max(1, Math.floor(maxPages));
  const bySku = new Map();
  let total = null;
  let totalPages = null;

  /** One walk through the pages. Reports how it went; the caller decides whether to walk again. */
  async function readPass() {
    const seen = new Set();
    const totalsSeen = new Set();
    let pages = 0; // last page that really returned listings

    const outcome = (fault) => ({
      pages,
      fault,
      clean: !fault && totalsSeen.size <= 1 && total !== null && seen.size >= total,
    });

    for (let page = 1; page <= pageLimit; page++) {
      const data = await fetchSearchPage(page);

      const t = toNum(data.total);
      if (t !== null) {
        total = t;
        totalsSeen.add(t);
      }
      totalPages = toNum(data.totalPages) ?? totalPages;
      if (totalPages !== null && totalPages > pageLimit) {
        throw new FetchError('incomplete', `The site has ${totalPages} pages of results but MAX_PAGES is ${pageLimit}; raise MAX_PAGES`);
      }

      let fresh = 0;
      for (const p of data.products) {
        if (!p || p.sku === undefined || p.sku === null) continue;
        const sku = String(p.sku);
        if (!seen.has(sku)) {
          seen.add(sku);
          fresh++;
        }
        bySku.set(sku, p);
      }
      if (fresh > 0) pages = page;

      const knowsEnd = totalPages !== null || total !== null;
      const shortOfTotal = total !== null && seen.size < total;
      // Without any totals we keep going until the site runs dry.
      const moreExpected = !knowsEnd || (totalPages !== null ? page < totalPages : shortOfTotal);
      const empty = data.products.length === 0;

      if (fresh === 0) {
        let fault = null;
        if (empty) {
          if (totalPages !== null && page < totalPages) fault = `page ${page} of ${totalPages} came back empty`;
        } else if (knowsEnd && (moreExpected || shortOfTotal)) {
          fault = `page ${page} only repeated listings already seen, so the site seems to ignore the page number`;
        }
        return outcome(fault);
      }
      if (!moreExpected) return outcome(null);
      if (page === pageLimit) {
        throw new FetchError('incomplete', `The list is still going after ${pageLimit} pages; raise MAX_PAGES`);
      }
      await sleep(jitter(config.pageDelayMs[0], config.pageDelayMs[1]));
    }
    throw new FetchError('incomplete', 'MAX_PAGES must be at least 1');
  }

  let last = null;
  let passesDone = 0;
  for (let pass = 1; pass <= passes; pass++) {
    last = await readPass();
    passesDone = pass;
    if (last.clean) break;
    if (pass < passes) await sleep(jitter(config.rereadDelayMs[0], config.rereadDelayMs[1]));
  }

  const read = bySku.size;
  const warnings = [];
  if (total !== null && read < total) {
    const floor = Math.floor((total * config.minCoveragePercent) / 100);
    if (last.fault || read < floor) {
      throw new FetchError(
        'incomplete',
        `Only ${read} of ${total} listings came back after ${passesDone} ${passesDone === 1 ? 'read' : 'reads'}${last.fault ? ` (${last.fault})` : ''}`,
      );
    }
    warnings.push(`read ${read} of the ${total} listings the site reports`);
  }
  return { raw: [...bySku.values()], read, totalReported: total, pages: last.pages, passes: passesDone, warnings };
}

/** Best effort: the product-detail endpoint adds description / specs. Never fatal. */
export async function fetchProductDetail(sku) {
  return requestJson(buildDetailUrl(sku), { attempts: 1 });
}
