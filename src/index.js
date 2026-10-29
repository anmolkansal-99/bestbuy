#!/usr/bin/env node
import { config } from './config.js';
import { runOnce, sendTest } from './run.js';
import { closeTransport } from './mailer.js';
import { log, sleep, jitter, scrub } from './util.js';

const args = new Set(process.argv.slice(2));

/** Long-running mode for a home PC / Raspberry Pi / free VM. */
async function watch() {
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      stopping = true;
      log(`${sig} received, stopping after the current check`);
    });
  }
  log(`watching every ~${config.pollIntervalSeconds}s (Ctrl+C to stop)`);
  while (!stopping) {
    try {
      await runOnce();
    } catch (err) {
      log(`check failed: ${scrub(err.message)}`);
    }
    const wait = jitter(config.pollIntervalSeconds * 850, config.pollIntervalSeconds * 1150);
    for (let waited = 0; waited < wait && !stopping; waited += 1000) await sleep(1000);
  }
}

async function main() {
  if (args.has('--test-email')) {
    await sendTest();
    return;
  }
  if (args.has('--watch')) {
    await watch();
    return;
  }
  await runOnce({ preview: args.has('--preview'), dumpRaw: args.has('--dump-raw') });
}

main()
  .catch((err) => {
    log(`fatal: ${scrub(err.message)}`);
    process.exitCode = 1;
  })
  .finally(closeTransport);
