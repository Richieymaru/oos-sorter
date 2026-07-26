#!/usr/bin/env node
/** Pure tests for the session-token verifier. node session.test.mjs */
import crypto from 'node:crypto';
import { verifySessionToken } from './session.mjs';

let failures = 0, checks = 0;
function ok(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL ${label}`); }
  else console.log(`  ok  ${label}`);
}

const SECRET = 'shpss_testsecret';
const CLIENT_ID = 'client-123';
const SHOP = 'test-apps.myshopify.com';
const NOW = 1_800_000_000;

function makeToken(payload, secret = SECRET) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
const goodPayload = {
  iss: `https://${SHOP}/admin`,
  dest: `https://${SHOP}`,
  aud: CLIENT_ID,
  sub: '42',
  exp: NOW + 30,
  nbf: NOW - 10,
  iat: NOW - 10,
};
const opts = { clientId: CLIENT_ID, clientSecret: SECRET, shop: SHOP, now: NOW };
const bearer = (p, secret) => `Bearer ${makeToken(p, secret)}`;

console.log('--- valid token ---');
const okRes = verifySessionToken(bearer(goodPayload), opts);
ok('valid token returns payload', okRes && okRes.sub === '42');
ok('case-insensitive Bearer', !!verifySessionToken(`bearer ${makeToken(goodPayload)}`, opts));

console.log('\n--- rejects ---');
ok('missing header -> null', verifySessionToken(undefined, opts) === null);
ok('no Bearer prefix -> null', verifySessionToken(makeToken(goodPayload), opts) === null);
ok('malformed (2 parts) -> null', verifySessionToken('Bearer a.b', opts) === null);
ok('wrong signing secret -> null', verifySessionToken(bearer(goodPayload, 'other'), opts) === null);
ok('tampered payload -> null', (() => {
  const t = makeToken(goodPayload);
  const [h, , s] = t.split('.');
  const evil = Buffer.from(JSON.stringify({ ...goodPayload, sub: '999' })).toString('base64url');
  return verifySessionToken(`Bearer ${h}.${evil}.${s}`, opts) === null;
})());
ok('expired -> null', verifySessionToken(bearer({ ...goodPayload, exp: NOW - 1 }), opts) === null);
ok('not-yet-valid (nbf future) -> null', verifySessionToken(bearer({ ...goodPayload, nbf: NOW + 100 }), opts) === null);
ok('wrong aud (other app) -> null', verifySessionToken(bearer({ ...goodPayload, aud: 'other-app' }), opts) === null);
ok('wrong dest (other shop) -> null', verifySessionToken(bearer({ ...goodPayload, dest: 'https://evil.myshopify.com' }), opts) === null);
ok('missing secret in opts -> null', verifySessionToken(bearer(goodPayload), { clientId: CLIENT_ID, shop: SHOP, now: NOW }) === null);
ok('shop check skipped when shop omitted', !!verifySessionToken(bearer(goodPayload), { clientId: CLIENT_ID, clientSecret: SECRET, now: NOW }));

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
