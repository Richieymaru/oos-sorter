#!/usr/bin/env node
/** Offline tests for the pure OAuth helpers. node oauth.test.mjs */
import crypto from 'node:crypto';
import { authorizeUrl, signState, verifyState, verifyCallbackHmac, isShop } from './oauth.mjs';

let failures = 0, checks = 0;
function ok(label, cond) {
  checks++;
  if (!cond) { failures++; console.error(`FAIL ${label}`); }
  else console.log(`  ok  ${label}`);
}

console.log('--- isShop ---');
ok('valid', isShop('my-store.myshopify.com'));
ok('rejects other host', !isShop('evil.com'));
ok('rejects path injection', !isShop('x.myshopify.com/evil'));

console.log('\n--- authorizeUrl ---');
const url = authorizeUrl({ shop: 'shop.myshopify.com', clientId: 'cid', scopes: 'read_products', redirectUri: 'https://a/cb', state: 'st' });
ok('correct host + path', url.startsWith('https://shop.myshopify.com/admin/oauth/authorize?'));
ok('has client_id', url.includes('client_id=cid'));
ok('has scope', url.includes('scope=read_products'));
ok('encodes redirect_uri', url.includes('redirect_uri=https%3A%2F%2Fa%2Fcb'));
ok('has state', url.includes('state=st'));
let threw = false; try { authorizeUrl({ shop: 'evil.com', clientId: 'c', redirectUri: 'r', state: 's' }); } catch { threw = true; }
ok('throws on bad shop', threw);

console.log('\n--- signState / verifyState ---');
const st = signState('shop.myshopify.com', 'secret');
ok('round-trips to shop', verifyState(st, 'secret') === 'shop.myshopify.com');
ok('wrong secret -> null', verifyState(st, 'other') === null);
ok('tampered -> null', verifyState(st.slice(0, -2) + 'zz', 'secret') === null);
ok('garbage -> null', verifyState('nope', 'secret') === null);

console.log('\n--- verifyCallbackHmac ---');
const secret = 'shhh';
const q = { code: 'abc123', shop: 'shop.myshopify.com', state: 'st', timestamp: '1700000000' };
const msg = Object.keys(q).sort().map((k) => `${k}=${q[k]}`).join('&');
const good = crypto.createHmac('sha256', secret).update(msg).digest('hex');
ok('valid hmac passes', verifyCallbackHmac({ ...q, hmac: good }, secret));
ok('missing hmac fails', verifyCallbackHmac(q, secret) === false);
ok('tampered param fails', verifyCallbackHmac({ ...q, code: 'x', hmac: good }, secret) === false);
ok('wrong secret fails', verifyCallbackHmac({ ...q, hmac: good }, 'nope') === false);

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
