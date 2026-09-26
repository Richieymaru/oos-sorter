#!/usr/bin/env node
/** Pure tests for the Gemini request/response shaping. node gemini.test.mjs */
import { geminiBody, geminiText } from './gemini.mjs';

let failures = 0, checks = 0;
function ok(label, cond) { checks++; if (!cond) { failures++; console.error(`FAIL ${label}`); } else console.log(`  ok  ${label}`); }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('--- geminiBody ---');
const b = geminiBody('SYS', [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }, { role: 'user', text: 'how many sold out?' }]);
ok('system instruction set', b.system_instruction.parts[0].text === 'SYS');
ok('maps user role', b.contents[0].role === 'user' && b.contents[0].parts[0].text === 'hi');
ok('maps assistant -> model', b.contents[1].role === 'model' && b.contents[1].parts[0].text === 'hello');
ok('keeps order', b.contents[2].parts[0].text === 'how many sold out?');
ok('accepts content field too', geminiBody('S', [{ role: 'user', content: 'x' }]).contents[0].parts[0].text === 'x');
ok('empty messages safe', eq(geminiBody('S', null).contents, []));
ok('has a generation config', typeof b.generationConfig.maxOutputTokens === 'number');

console.log('\n--- geminiText ---');
ok('extracts the reply text', geminiText({ candidates: [{ content: { parts: [{ text: 'Answer.' }] } }] }) === 'Answer.');
ok('joins multiple parts', geminiText({ candidates: [{ content: { parts: [{ text: 'A' }, { text: 'B' }] } }] }) === 'AB');
ok('empty on missing candidates', geminiText({}) === '');
ok('empty on null', geminiText(null) === '');

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
