import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Empty strings count as "not set" (GitHub passes unset secrets as empty strings).
const raw = (key) => {
  const v = process.env[key];
  return v === undefined || v.trim() === '' ? undefined : v.trim();
};
const str = (key, fallback) => raw(key) ?? fallback;
const num = (key, fallback) => {
  const v = raw(key);
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const flag = (key, fallback) => {
  const v = raw(key);
  return v === undefined ? fallback : /^(1|true|yes|on)$/i.test(v);
};
const list = (key, fallback) =>
  str(key, fallback).split(',').map((s) => s.trim()).filter(Boolean);

// The category page from the request: Gaming Laptops, condition = Open Box / Geek Squad Open Box /
// Refurbished Excellent, price $200–$1950. The API query is derived from this URL (see fetcher.js).
export const DEFAULT_PAGE_URL =
  'https://www.bestbuy.ca/en-ca/category/gaming-laptops/36712?path=category%253AComputers%2B%2526%2BTablets%253Bcategory%253ALaptops%2B%2526%2BMacBooks%253Bcategory%253AGaming%2BLaptops%253Bcustom0productcondition%253AOpen%2BBox%257CGeek%2BSquad%2BOpen%2BBox%257CRefurbished%2BExcellent%253BcurrentPrice%253A%5B200%2520TO%25201950%5D';

const smtpPort = num('SMTP_PORT', 465);
const smtpUser = str('SMTP_USER', '');

export const config = {
  root: ROOT,

  // --- what to watch -------------------------------------------------------
  pageUrl: str('PAGE_URL', DEFAULT_PAGE_URL),
  // Optional: paste the "search?..." request URL from your browser's DevTools (Network tab) here
  // if the URL derived from PAGE_URL ever returns the wrong set of laptops.
  apiUrlOverride: str('API_URL', ''),
  apiBase: str('API_BASE', 'https://www.bestbuy.ca').replace(/\/$/, ''),
  siteBase: 'https://www.bestbuy.ca',
  region: str('REGION', 'ON'), // province code: prices / availability are region-scoped
  lang: str('SITE_LANG', 'en-CA'),
  pageSize: num('PAGE_SIZE', 24),
  // A safety stop (40 pages x 24 = 960 laptops), never a silent cut-off: a longer list is reported as an error.
  maxPages: num('MAX_PAGES', 40),
  // Fail the check (instead of comparing) when the site returns clearly less than the total it reports.
  minCoveragePercent: num('MIN_COVERAGE_PERCENT', 90),

  // --- request behaviour ---------------------------------------------------
  userAgent: str(
    'USER_AGENT',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  ),
  requestTimeoutMs: num('REQUEST_TIMEOUT_MS', 20_000),
  retries: num('FETCH_RETRIES', 3),
  retryBaseMs: num('RETRY_BASE_MS', 2_000),
  pageDelayMs: [num('PAGE_DELAY_MIN_MS', 800), num('PAGE_DELAY_MAX_MS', 1_500)],
  rereadDelayMs: [num('REREAD_DELAY_MIN_MS', 2_000), num('REREAD_DELAY_MAX_MS', 3_000)], // pause before re-reading the list

  // --- what counts as a change --------------------------------------------
  notifyOn: new Set(list('NOTIFY_ON', 'new,price_drop,restock')), // also: price_increase, removed
  minPriceDrop: num('MIN_PRICE_DROP', 1), // CAD
  removeAfterMisses: num('REMOVE_AFTER_MISSES', 3), // polls a listing may vanish before it's "removed"
  goneRetentionDays: num('GONE_RETENTION_DAYS', 45),
  fetchDetails: flag('FETCH_DETAILS', true),
  maxDetailedCards: num('MAX_DETAILED_CARDS', 12),
  baselineEmail: flag('BASELINE_EMAIL', true),

  // --- housekeeping ----------------------------------------------------------
  stateFile: str('STATE_FILE', path.join(ROOT, 'data', 'state.json')),
  outDir: str('OUT_DIR', path.join(ROOT, 'out')),
  heartbeatDays: num('HEARTBEAT_DAYS', 20), // keeps GitHub from pausing the schedule after 60 idle days
  failureAlertAfterMinutes: num('FAILURE_ALERT_AFTER_MINUTES', 45),
  failureReminderHours: num('FAILURE_REMINDER_HOURS', 24),
  pollIntervalSeconds: num('POLL_INTERVAL_SECONDS', 120), // only used by --watch
  reportTz: str('REPORT_TZ', 'Asia/Kolkata'),
  storeTz: 'America/Toronto',

  // --- email ---------------------------------------------------------------
  smtp: {
    host: str('SMTP_HOST', 'smtp.gmail.com'),
    port: smtpPort,
    secure: flag('SMTP_SECURE', smtpPort === 465),
    ignoreTls: flag('SMTP_IGNORE_TLS', false),
    user: smtpUser,
    pass: str('SMTP_PASS', ''),
  },
  mail: {
    to: list('MAIL_TO', ''),
    from: str('MAIL_FROM', smtpUser || 'monitor@localhost'),
    subjectPrefix: str('SUBJECT_PREFIX', '[BestBuy.ca]'),
    retries: num('MAIL_RETRIES', 3),
    retryBaseMs: num('MAIL_RETRY_BASE_MS', 3_000),
  },
};

/** Human-readable list of what is missing before email can work. */
export function mailProblems() {
  const problems = [];
  if (!config.mail.to.length) problems.push('MAIL_TO is not set');
  const local = ['127.0.0.1', 'localhost', '::1'].includes(config.smtp.host);
  if (!local && (!config.smtp.user || !config.smtp.pass)) {
    problems.push('SMTP_USER / SMTP_PASS are not set');
  }
  return problems;
}
