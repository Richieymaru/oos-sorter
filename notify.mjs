/**
 * Email notifications via Gmail SMTP (nodemailer). The only module that knows
 * about email transport — swap this one file to move to an email API later.
 *
 * Two shapes:
 *   - daily digest: the products that newly sold out today
 *   - on-demand report: the full current sold-out list, sent now
 *
 * Env: GMAIL_USER, GMAIL_APP_PASSWORD (a 16-char Gmail App Password, requires
 * 2-step verification), NOTIFY_EMAIL (recipient).
 */

import nodemailer from 'nodemailer';

const SHOP = process.env.SHOP_DOMAIN;

function creds() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.NOTIFY_EMAIL;
  const missing = [
    !user && 'GMAIL_USER',
    !pass && 'GMAIL_APP_PASSWORD',
    !to && 'NOTIFY_EMAIL',
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `FEATURE_NOTIFY is on but these are missing: ${missing.join(', ')}. ` +
        'Set them in .env (GMAIL_APP_PASSWORD is a Gmail App Password, not your login password).'
    );
  }
  return { user, pass, to };
}

/** Render one product line: "Title (collection-a, collection-b)". */
function line(item) {
  const cols = item.collections?.length ? `  (${item.collections.join(', ')})` : '';
  return `  • ${item.title ?? item.id}${cols}`;
}

/** Pure: build the daily digest email body from pending entries. Exported for tests. */
export function buildDigest(pending) {
  const n = pending.length;
  const subject = `OOS Sorter: ${n} product${n === 1 ? '' : 's'} sold out today`;
  const text =
    `${n} product${n === 1 ? '' : 's'} newly sold out on ${SHOP} today:\n\n` +
    pending.map(line).join('\n') +
    `\n\n— OOS Sorter`;
  return { subject, text };
}

/** Pure: build the on-demand report email body from the current sold-out list. */
export function buildReport(items) {
  const n = items.length;
  const subject = `OOS Sorter: sold-out report (${n})`;
  const text =
    n === 0
      ? `No products are currently sold out on ${SHOP}.\n\n— OOS Sorter`
      : `${n} product${n === 1 ? '' : 's'} currently sold out on ${SHOP}:\n\n` +
        items.map(line).join('\n') +
        `\n\n— OOS Sorter`;
  return { subject, text };
}

let transportCache = null;
function transport(user, pass) {
  if (!transportCache) {
    transportCache = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user, pass },
    });
  }
  return transportCache;
}

async function send({ subject, text }, { dryRun } = {}) {
  if (dryRun) {
    // Don't require email credentials just to preview — only real sends need them.
    const to = process.env.NOTIFY_EMAIL ?? '(NOTIFY_EMAIL unset)';
    console.log(`  [dry run] would email ${to}: "${subject}"`);
    text.split('\n').forEach((l) => console.log(`      ${l}`));
    return { dryRun: true };
  }
  const { user, pass, to } = creds();
  const info = await transport(user, pass).sendMail({
    from: `OOS Sorter <${user}>`,
    to,
    subject,
    text,
  });
  console.log(`  emailed ${to}: "${subject}" (${info.messageId})`);
  return info;
}

export function sendDigest(pending, opts) {
  return send(buildDigest(pending), opts);
}

export function sendReport(items, opts) {
  return send(buildReport(items), opts);
}
