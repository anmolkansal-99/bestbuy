import fs from 'node:fs/promises';
import path from 'node:path';
import { config, mailProblems } from './config.js';
import { fetchAllListings, fetchProductDetail, FetchError } from './fetcher.js';
import { normalizeProduct, extractDetails } from './normalize.js';
import { loadState, saveState } from './state.js';
import { diffListings, shouldNotify } from './diff.js';
import { buildReport, buildFailureEmail, buildRecoveryEmail, buildTestEmail } from './report.js';
import { sendMail } from './mailer.js';
import { log, sleep, jitter, median, scrub, plural } from './util.js';

const active = (state) => Object.values(state.listings ?? {}).filter((e) => !e.missCount);

function summarize(entries) {
  const prices = entries.map((e) => e.price).filter(Number.isFinite);
  return { count: entries.length, cheapest: prices.length ? Math.min(...prices) : null, median: median(prices) };
}

/** Touch the state file every few weeks so GitHub never sees the repo as inactive. */
function applyHeartbeat(state, now) {
  const last = state.lastHeartbeatAt ? new Date(state.lastHeartbeatAt).getTime() : 0;
  if (now.getTime() - last >= config.heartbeatDays * 86_400_000) state.lastHeartbeatAt = now.toISOString();
}

async function writePreview(report) {
  await fs.mkdir(config.outDir, { recursive: true });
  await fs.writeFile(path.join(config.outDir, 'report.html'), report.html);
  await fs.writeFile(path.join(config.outDir, 'report.txt'), report.text);
  await fs.writeFile(path.join(config.outDir, 'comparison.csv'), report.attachments[0].content);
  log(`preview written to ${config.outDir} (subject: "${report.subject}")`);
}

async function writeRawSample(raw) {
  await fs.mkdir(config.outDir, { recursive: true });
  const file = path.join(config.outDir, 'raw-sample.json');
  await fs.writeFile(file, JSON.stringify(raw.slice(0, 3), null, 2));
  log(`first ${Math.min(3, raw.length)} raw products written to ${file}`);
}

async function collectDetails(result) {
  const out = {};
  if (!config.fetchDetails || result.baseline) return out;
  const targets = [...result.newListings, ...result.relisted].slice(0, config.maxDetailedCards);
  for (const item of targets) {
    try {
      const extracted = extractDetails(await fetchProductDetail(item.sku));
      if (extracted) out[item.sku] = extracted;
    } catch (err) {
      log(`no extra details for ${item.sku}: ${err.message}`);
    }
    await sleep(jitter(250, 600));
  }
  return out;
}

async function handleFetchFailure({ state, err, now, preview }) {
  const label = err instanceof FetchError ? err.label : 'error';
  log(`poll failed (${label}): ${scrub(err.message)}`);

  const outage = state.outage ?? { since: now.toISOString(), alertedAt: null, error: label };
  outage.error = label;
  const downMinutes = (now.getTime() - new Date(outage.since).getTime()) / 60_000;
  const firstDue = !outage.alertedAt && downMinutes >= config.failureAlertAfterMinutes;
  const reminderDue = outage.alertedAt && (now.getTime() - new Date(outage.alertedAt).getTime()) / 3_600_000 >= config.failureReminderHours;

  let emailed = false;
  if ((firstDue || reminderDue) && !preview) {
    try {
      await sendMail(buildFailureEmail({ outage, error: err, now, downMinutes }));
      outage.alertedAt = now.toISOString();
      emailed = true;
    } catch (mailErr) {
      log(`could not send the outage alert: ${scrub(mailErr.message)}`);
    }
  }

  state.outage = outage;
  applyHeartbeat(state, now);
  const stateSaved = preview ? false : await saveState(config.stateFile, state, now);
  return { ok: false, kind: 'failure', error: label, emailed, stateSaved };
}

/**
 * One poll: fetch -> compare with the saved snapshot -> email if something changed -> save snapshot.
 * The snapshot is saved only AFTER the email went out, so a mail failure can never swallow a new laptop.
 */
export async function runOnce({ now = new Date(), preview = false, dumpRaw = false } = {}) {
  const state = await loadState(config.stateFile);

  let fetched;
  try {
    fetched = await fetchAllListings();
  } catch (err) {
    return handleFetchFailure({ state, err, now, preview });
  }
  if (dumpRaw) await writeRawSample(fetched.raw);

  const items = [];
  for (const p of fetched.raw) {
    try {
      items.push(normalizeProduct(p));
    } catch (err) {
      log(`skipping unreadable product ${p?.sku}: ${err.message}`);
    }
  }
  if (fetched.raw.length > 0 && items.length === 0) {
    return handleFetchFailure({ state, err: new FetchError('bad_shape', 'None of the returned products could be read'), now, preview });
  }
  for (const w of fetched.warnings) log(`warning: ${w}`);

  // What the comparison is based on. It goes into every email so you can see that the whole list was checked.
  const coverage = { read: items.length, total: fetched.totalReported, pages: fetched.pages };
  log(
    `read ${coverage.read} of ${coverage.total ?? 'an unknown number of'} listings (${fetched.pages} ${plural(fetched.pages, 'page')} of results, ${fetched.passes} ${plural(fetched.passes, 'read')})`,
  );

  const before = summarize(active(state));
  const { result, nextState } = diffListings(state, items, now, config);
  const entries = active(nextState);
  const after = summarize(entries);

  let emailed = false;
  if (shouldNotify(result, config)) {
    const details = await collectDetails(result);
    const report = buildReport({ result, entries, stats: { before, after }, coverage, now, details });
    if (preview) {
      await writePreview(report);
    } else {
      await sendMail(report); // throws on failure -> snapshot is NOT saved -> next run retries
      emailed = true;
    }
  }

  if (state.outage) {
    let cleared = true;
    if (state.outage.alertedAt && !preview) {
      try {
        await sendMail(buildRecoveryEmail({ outage: state.outage, now, count: items.length }));
      } catch (err) {
        cleared = false;
        log(`could not send the recovery notice: ${scrub(err.message)}`);
      }
    }
    nextState.outage = cleared ? null : state.outage;
  }

  applyHeartbeat(nextState, now);
  const stateSaved = preview ? false : await saveState(config.stateFile, nextState, now);

  const kind = result.baseline ? 'baseline' : shouldNotify(result, config) ? 'changes' : 'nochange';
  const counts = {
    listed: items.length,
    new: result.newListings.length,
    relisted: result.relisted.length,
    priceDrops: result.priceDrops.length,
    priceRises: result.priceRises.length,
    restocks: result.restocks.length,
    removed: result.removed.length,
  };
  log(
    `poll ok (${kind}): ${counts.listed} listed, ${result.baseline ? 'baseline' : `${counts.new} new, ${counts.relisted} relisted, ${counts.priceDrops} drops, ${counts.restocks} restocks, ${counts.removed} removed`}; email ${emailed ? 'sent' : 'not needed'}; snapshot ${stateSaved ? 'updated' : 'unchanged'}`,
  );
  return { ok: true, kind, counts, coverage, emailed, stateSaved, result };
}

export async function sendTest() {
  const problems = mailProblems();
  if (problems.length) throw new Error(`Email is not configured: ${problems.join('; ')}`);
  await sendMail(buildTestEmail({ now: new Date() }));
}
