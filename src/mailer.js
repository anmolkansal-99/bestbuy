import nodemailer from 'nodemailer';
import { config, mailProblems } from './config.js';
import { sleep, log, scrub } from './util.js';

let transport;

function getTransport() {
  if (!transport) {
    const { smtp } = config;
    transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      ignoreTLS: smtp.ignoreTls,
      auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 45_000,
    });
  }
  return transport;
}

export function closeTransport() {
  transport?.close();
  transport = undefined;
}

/** Sends one email, retrying a few times. Throws if it still fails (callers must not advance state). */
export async function sendMail({ subject, html, text, attachments = [] }) {
  const problems = mailProblems();
  if (problems.length) throw new Error(`Email is not configured: ${problems.join('; ')}`);

  let lastError;
  for (let attempt = 1; attempt <= config.mail.retries; attempt++) {
    try {
      await getTransport().sendMail({
        from: { name: 'Best Buy CA monitor', address: config.mail.from },
        to: config.mail.to,
        subject,
        html,
        text,
        attachments,
      });
      log(`email sent: "${subject}"`);
      return;
    } catch (err) {
      lastError = err;
      log(`email attempt ${attempt}/${config.mail.retries} failed: ${scrub(err.message)}`);
      if (attempt < config.mail.retries) {
        closeTransport(); // drop a possibly broken connection
        await sleep(config.mail.retryBaseMs * attempt);
      }
    }
  }
  throw new Error(`Could not send email after ${config.mail.retries} attempts: ${scrub(lastError?.message)}`);
}
