/**
 * ALMA's replies with their markdown drawn, not printed (chat-markdown.ts).
 *
 * Before: a reply read "**Oct 16** is the last day to drop" with the stars
 * showing. What this pins: bold, italics, code and links become spans; a
 * stray or half-streamed "**" is dropped; underscores in tool names stay;
 * "3 * 4" stays; only http(s) links are links; newlines are kept.
 *
 *   node lib/planner/__chat-markdown.check.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
if (!process.execArgv.some((a) => a.includes('strip-types'))) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const { chatSpans, chatPlainText } = await import(join(HERE, 'chat-markdown.ts'));

let failures = 0;
/** Key order does not matter: a span is compared field by field. */
const norm = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const check = (name, got, want) => {
  const a = norm(got);
  const b = norm(want);
  if (a === b) console.log(`  ok    ${name}`);
  else { failures += 1; console.log(`  FAIL  ${name}\n        got  ${a}\n        want ${b}`); }
};

check('bold', chatSpans('**Oct 16** is the last day.'), [{ text: 'Oct 16', strong: true }, { text: ' is the last day.' }]);
check('underscore bold', chatSpans('__MATH 221__ first'), [{ text: 'MATH 221', strong: true }, { text: ' first' }]);
check('italic around a word', chatSpans('an *estimate* only'), [{ text: 'an ' }, { text: 'estimate', em: true }, { text: ' only' }]);
check('a times sign stays', chatSpans('3 * 4 hours'), [{ text: '3 * 4 hours' }]);
check('code', chatSpans('use `university_answer` here'), [{ text: 'use ' }, { text: 'university_answer', code: true }, { text: ' here' }]);
check('underscores in a word stay', chatSpans('crnc_eligible is set'), [{ text: 'crnc_eligible is set' }]);
check('an https link', chatSpans('see [the registrar](https://registrar.illinois.edu/x)'), [{ text: 'see ' }, { text: 'the registrar', href: 'https://registrar.illinois.edu/x' }]);
check('a javascript: link is not a link', chatPlainText('[x](javascript:alert(1))').includes('javascript') && !chatSpans('[x](javascript:alert(1))').some((s) => s.href), true);
check('an unclosed ** is dropped (mid-stream)', chatSpans('The deadline is **Oct'), [{ text: 'The deadline is Oct' }]);
check('a heading reads bold', chatSpans('## Next steps'), [{ text: 'Next steps', strong: true }]);
check('a * bullet reads as a dot', chatSpans('* CS 124\n* MATH 221'), [{ text: '• CS 124\n• MATH 221' }]);
check('a - bullet is left alone', chatSpans('- CS 124'), [{ text: '- CS 124' }]);
check('newlines kept', chatSpans('one\n\ntwo'), [{ text: 'one\n\ntwo' }]);
check('bold inside a link label', chatSpans('[**CS 124**](https://cs.illinois.edu)'), [{ text: 'CS 124', strong: true, href: 'https://cs.illinois.edu' }]);
check('no stars survive in plain text', /\*\*/.test(chatPlainText('**a** and **b and ** c')), false);
check('plain text keeps the link address', chatPlainText('[page](https://a.illinois.edu)'), 'page (https://a.illinois.edu)');

console.log(`\n${failures === 0 ? 'ALL CHAT MARKDOWN CHECKS PASSED' : `${failures} CHAT MARKDOWN CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
