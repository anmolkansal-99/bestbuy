import { config } from './config.js';
import { toNum, stripHtml, truncate } from './util.js';

const KNOWN_BRANDS = [
  'ASUS', 'Acer', 'MSI', 'Lenovo', 'HP', 'Dell', 'Alienware', 'Gigabyte', 'AORUS', 'Razer', 'Apple',
  'Samsung', 'Microsoft', 'LG', 'Huawei', 'Toshiba', 'Framework', 'Origin', 'XMG', 'Medion',
];

const firstString = (...vals) => vals.find((v) => typeof v === 'string' && v.trim() !== '')?.trim() ?? null;

export function guessBrand(name) {
  const cleaned = String(name).replace(/^(geek squad\s+)?(certified\s+)?(open[\s-]*box|refurbished)\s*[-:–]?\s*/i, '');
  const hit = KNOWN_BRANDS.find((b) => new RegExp(`^${b}\\b`, 'i').test(cleaned));
  return hit ?? null;
}

export function detectCondition(name = '', p = {}) {
  const hay = `${name} ${p.productCondition ?? ''} ${p.condition ?? ''}`;
  if (/geek\s*squad[\s\w]*open[\s-]*box/i.test(hay)) return 'Geek Squad Open Box';
  if (/open[\s-]*box/i.test(hay)) return 'Open Box';
  if (/refurb[\w\s()\-:]*excellent|excellent[\s()\-:]*refurb/i.test(hay)) return 'Refurbished (Excellent)';
  if (/refurb/i.test(hay)) return 'Refurbished';
  return null;
}

/** Best-effort spec extraction from titles like: ASUS ROG 16" 165Hz (Intel Core i7/16GB RAM/1TB SSD/RTX 4060) */
export function parseSpecsFromName(name = '') {
  const specs = {};
  const screen = name.match(/(\d{2}(?:\.\d)?)\s*(?:"|”|''|in(?:ch)?\b)/i);
  if (screen) specs.screen = `${screen[1]}"`;
  const hz = name.match(/(\d{2,3})\s?Hz/i);
  if (hz) specs.refresh = `${hz[1]} Hz`;

  const groups = [...name.matchAll(/\(([^()]*\/[^()]*)\)/g)];
  const group = groups.length ? groups[groups.length - 1][1] : '';
  for (const token of group.split('/').map((t) => t.trim()).filter(Boolean)) {
    if (!specs.gpu && /(geforce|\brtx\b|\bgtx\b|radeon|\barc\b|nvidia)/i.test(token)) specs.gpu = token;
    else if (!specs.cpu && /(intel|core\s?(?:i\d|ultra)|ryzen|\bamd\b|snapdragon|apple\s?m\d)/i.test(token)) specs.cpu = token;
    else if (!specs.storage && /\d+(?:\.\d+)?\s?(?:TB|GB)\b.*(?:SSD|HDD|NVMe|eMMC|PCIe|M\.2)|(?:SSD|HDD|NVMe)/i.test(token)) specs.storage = token;
    else if (!specs.ram && /\d+\s?GB/i.test(token) && /(ram|ddr|memory)/i.test(token)) specs.ram = token.replace(/\s*RAM\s*$/i, ' RAM');
  }
  return specs;
}

const toBool = (s) => {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/[\s_-]/g, '').toLowerCase();
  if (/^(instock|available|limitedavailability|addtocart|backorder|backordered|preorder|buynow)$/.test(t)) return true;
  if (/^(outofstock|soldout|soldoutonline|soldoutinstore|unavailable|notavailable|comingsoon|seedetails|notsoldonline|outofstockonline)$/.test(t)) return false;
  return null;
};

/**
 * The listing API reports availability in a couple of shapes; read whichever is present.
 * `buyable` is true when any channel (ship / pickup) can be purchased, false when all known channels
 * are not, and null when nothing recognisable is present.
 */
export function readAvailability(p = {}) {
  const a = p.availability && typeof p.availability === 'object' ? p.availability : {};
  const ship = a.shipping && typeof a.shipping === 'object' ? a.shipping : {};
  const pick = a.pickup && typeof a.pickup === 'object' ? a.pickup : {};
  const shipStatus = ship.status ?? a.onlineAvailability ?? p.onlineAvailability ?? null;
  const pickStatus = pick.status ?? a.inStoreAvailability ?? p.inStoreAvailability ?? null;
  const button = a.buttonState ?? p.buttonState ?? null;

  const signals = [];
  for (const v of [ship.purchasable, pick.purchasable]) if (typeof v === 'boolean') signals.push(v);
  for (const v of [shipStatus, pickStatus, button]) {
    const b = toBool(v);
    if (b !== null) signals.push(b);
  }
  const buyable = signals.length ? signals.some(Boolean) : null;
  const text =
    [shipStatus && `Online: ${shipStatus}`, pickStatus && `Pickup: ${pickStatus}`].filter(Boolean).join(' · ') ||
    (button ? `Button: ${button}` : '');
  return { buyable, text };
}

function absoluteUrl(u, sku) {
  if (typeof u === 'string' && /^https?:\/\//i.test(u)) return u;
  if (typeof u === 'string' && u.startsWith('/')) return `${config.siteBase}${u}`;
  return `${config.siteBase}/en-ca/product/${sku}`;
}

/** One listing from the search API -> the compact shape we store and report on. */
export function normalizeProduct(p) {
  const sku = String(p.sku);
  const name = String(p.name ?? p.title ?? `SKU ${sku}`).replace(/\s+/g, ' ').trim();
  const price = toNum(p.salePrice ?? p.currentPrice ?? p.price);
  let regularPrice = toNum(p.regularPrice ?? p.originalPrice);
  if (regularPrice === null || (price !== null && regularPrice < price)) regularPrice = price;
  const { buyable, text } = readAvailability(p);
  const rating = toNum(p.customerRating ?? p.rating);

  return {
    sku,
    name,
    brand: firstString(p.brandName, p.brand) ?? guessBrand(name),
    model: firstString(p.modelNumber, p.model),
    url: absoluteUrl(firstString(p.productUrl, p.url), sku),
    image: firstString(p.highResImage, p.thumbnailImage, p.image),
    price,
    regularPrice,
    saleEndDate: safeIso(p.saleEndDate),
    condition: detectCondition(name, p),
    rating: rating && rating > 0 ? rating : null,
    ratingCount: toNum(p.customerRatingCount ?? p.ratingCount) ?? 0,
    seller: firstString(p.sellerName, p.seller?.name),
    flags: {
      onlineOnly: !!p.isOnlineOnly,
      storeOnly: !!p.isInStoreOnly,
      clearance: !!p.isClearance,
      marketplace: !!p.isMarketplace,
    },
    buyable,
    availabilityText: text,
    specs: parseSpecsFromName(name),
  };
}

/** Accepts ISO strings, epoch milliseconds or epoch seconds (as number or numeric string). */
function safeIso(v) {
  if (v === null || v === undefined || v === '') return null;
  let value = v;
  if (typeof v === 'number' || (typeof v === 'string' && /^\d{9,13}$/.test(v.trim()))) {
    const n = Number(v);
    value = n < 1e11 ? n * 1000 : n;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---- product-detail enrichment (best effort; shape is checked defensively) --------------------

function flattenSpecs(specs) {
  const rows = [];
  const push = (k, v) => {
    const key = stripHtml(k);
    const val = stripHtml(Array.isArray(v) ? v.join(', ') : v);
    if (key && val && rows.length < 40) rows.push([truncate(key, 40), truncate(val, 100)]);
  };
  const plain = (v) => typeof v === 'string' || typeof v === 'number' || Array.isArray(v);

  if (Array.isArray(specs)) {
    for (const s of specs) {
      if (!s || typeof s !== 'object') continue;
      if ('name' in s && 'value' in s) {
        push(s.name, s.value);
      } else {
        const nested = s.specs ?? s.items ?? s.attributes;
        if (Array.isArray(nested)) {
          for (const t of nested) if (t && typeof t === 'object' && 'name' in t) push(t.name, t.value);
        }
      }
    }
  } else if (specs && typeof specs === 'object') {
    for (const [k, v] of Object.entries(specs)) {
      if (plain(v)) push(k, v);
      else if (v && typeof v === 'object') {
        for (const [k2, v2] of Object.entries(v)) if (plain(v2)) push(k2, v2);
      }
    }
  }
  return rows;
}

export function extractDetails(d) {
  if (!d || typeof d !== 'object') return null;
  const root = d.product && typeof d.product === 'object' ? d.product : d;
  const out = { description: '', highlights: [], specs: [] };

  const desc = root.longDescription ?? root.description ?? root.shortDescription;
  if (typeof desc === 'string') out.description = truncate(stripHtml(desc), 600);

  const hl = root.highlights ?? root.keyFeatures ?? root.features;
  if (Array.isArray(hl)) {
    out.highlights = hl
      .map((h) => (typeof h === 'string' ? stripHtml(h) : stripHtml(h?.text ?? h?.name ?? '')))
      .filter(Boolean)
      .slice(0, 6)
      .map((t) => truncate(t, 140));
  }
  out.specs = flattenSpecs(root.specs ?? root.specifications).slice(0, 14);
  return out.description || out.highlights.length || out.specs.length ? out : null;
}
