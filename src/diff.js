import { round2 } from './util.js';

const SLIM_FIELDS = ['sku', 'name', 'brand', 'url', 'image', 'price', 'regularPrice', 'condition', 'firstSeenAt'];

/**
 * Compare the previous snapshot with what the site shows now.
 *
 * - new:       SKU never seen before
 * - relisted:  SKU that had disappeared and is back
 * - priceDrops / priceRises / restocks / soldOutOnline: changes on SKUs we already knew
 * - removed:   SKU absent for `removeAfterMisses` polls in a row (one-off glitches are ignored)
 */
export function diffListings(prevState, items, now, cfg) {
  const nowIso = now.toISOString();
  const prevListings = prevState.listings ?? {};
  const baseline = !prevState.baselineDone;

  const result = {
    baseline,
    newListings: [],
    relisted: [],
    priceDrops: [],
    priceRises: [],
    restocks: [],
    soldOutOnline: [],
    removed: [],
    unchanged: 0,
  };

  const listings = {};
  const gone = { ...(prevState.gone ?? {}) };
  const seen = new Set();

  for (const item of items) {
    seen.add(item.sku);
    const old = prevListings[item.sku];

    if (old) {
      const entry = { ...old, ...item, firstSeenAt: old.firstSeenAt ?? nowIso, missCount: 0 };
      let changed = false;

      if (Number.isFinite(item.price) && Number.isFinite(old.price)) {
        const delta = round2(item.price - old.price);
        if (Math.abs(delta) >= 0.01) {
          changed = true;
          entry.priceHistory = [...(old.priceHistory ?? []), { t: nowIso, p: item.price }].slice(-12);
          entry.lastPriceChangeAt = nowIso;
          const change = {
            item: entry,
            oldPrice: old.price,
            newPrice: item.price,
            amount: Math.abs(delta),
            percent: old.price ? (Math.abs(delta) / old.price) * 100 : 0,
          };
          if (delta < 0 && -delta >= cfg.minPriceDrop) result.priceDrops.push(change);
          else if (delta > 0) result.priceRises.push(change);
        }
      }
      if (old.buyable === false && item.buyable === true) {
        result.restocks.push({ item: entry });
        changed = true;
      } else if (old.buyable === true && item.buyable === false) {
        result.soldOutOnline.push({ item: entry });
        changed = true;
      }
      if (!changed) result.unchanged++;
      listings[item.sku] = entry;
    } else if (gone[item.sku]) {
      const entry = {
        ...item,
        firstSeenAt: gone[item.sku].firstSeenAt ?? nowIso,
        relistedAt: nowIso,
        missCount: 0,
        priceHistory: [{ t: nowIso, p: item.price }],
      };
      delete gone[item.sku];
      listings[item.sku] = entry;
      result.relisted.push(entry);
    } else {
      const entry = { ...item, firstSeenAt: nowIso, missCount: 0, priceHistory: [{ t: nowIso, p: item.price }] };
      listings[item.sku] = entry;
      result.newListings.push(entry);
    }
  }

  // Listings we knew about that were not in this poll.
  for (const [sku, old] of Object.entries(prevListings)) {
    if (seen.has(sku)) continue;
    const missCount = (old.missCount ?? 0) + 1;
    if (missCount >= cfg.removeAfterMisses) {
      gone[sku] = { ...Object.fromEntries(SLIM_FIELDS.map((k) => [k, old[k]])), goneAt: nowIso };
      result.removed.push(old);
    } else {
      listings[sku] = { ...old, missCount };
    }
  }

  const cutoff = now.getTime() - cfg.goneRetentionDays * 86_400_000;
  for (const [sku, g] of Object.entries(gone)) {
    if (new Date(g.goneAt).getTime() < cutoff) delete gone[sku];
  }

  const nextState = {
    ...prevState,
    createdAt: prevState.createdAt ?? nowIso,
    baselineDone: baseline ? items.length > 0 : true,
    listings,
    gone,
  };
  return { result, nextState };
}

/** Does this poll deserve an email? */
export function shouldNotify(result, cfg) {
  if (result.baseline) return cfg.baselineEmail && result.newListings.length > 0;
  const on = cfg.notifyOn;
  return (
    (on.has('new') && result.newListings.length + result.relisted.length > 0) ||
    (on.has('price_drop') && result.priceDrops.length > 0) ||
    (on.has('restock') && result.restocks.length > 0) ||
    (on.has('price_increase') && result.priceRises.length > 0) ||
    (on.has('removed') && result.removed.length > 0)
  );
}
