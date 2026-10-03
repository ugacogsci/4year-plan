import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const full = process.argv.includes('--full');
const tests = readdirSync(join(root, 'lib/planner'))
  .filter((name) => /^__.*\.check\.mjs$/.test(name))
  .filter((name) => full || name !== '__credit-rules.check.mjs')
  .sort().map((name) => `lib/planner/${name}`);
tests.push('scripts/uga-check.mjs');
const logs = mkdtempSync(join(tmpdir(), 'orion-checks-'));
console.log(`Running ${tests.length} planner suites. Logs: ${logs}`);
let next = 0;
let failures = 0;
async function worker() {
  while (next < tests.length) {
    const test = tests[next++];
    const started = Date.now();
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', test], { cwd: root });
      let output = '';
      child.stdout.on('data', (data) => { output += String(data); });
      child.stderr.on('data', (data) => { output += String(data); });
      child.on('error', (error) => { output += String(error); });
      child.on('close', (code) => resolve({ code, output }));
    });
    writeFileSync(join(logs, test.replaceAll('/', '_') + '.log'), result.output);
    const passed = result.code === 0;
    if (!passed) failures += 1;
    console.log(`${passed ? 'PASS' : 'FAIL'} ${test} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    if (!passed) console.error(result.output.split('\n').slice(-35).join('\n'));
  }
}
await Promise.all([worker(), worker()]);
console.log(`${tests.length - failures}/${tests.length} suites passed.${full ? '' : ' Use npm run test:full for the exhaustive credit audit.'}`);
process.exitCode = failures ? 1 : 0;
