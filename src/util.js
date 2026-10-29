import { config } from './config.js';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const jitter = (min, max) => Math.round(min + Math.random() * Math.max(0, max - min));
export const round2 = (n) => Math.round(n * 100) / 100;
export const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);

export function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

/** Tolerant number parser: 12, "12.5", "$1,299.99" -> number; anything else -> null. */
export function toNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
export const money = (n) => (Number.isFinite(n) ? cad.format(n) : '—');

export function fmtDateTime(date, timeZone) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
    timeZoneName: 'short',
  }).format(d);
}

export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function truncate(text, max) {
  const s = String(text ?? '').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Remove anything secret (recipient, SMTP login) from text before it is logged.
 * Action logs of public repositories are public.
 */
export function scrub(text) {
  let out = String(text ?? '');
  const secrets = [...config.mail.to, config.smtp.user, config.smtp.pass, config.mail.from];
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join('***');
  }
  return out;
}
