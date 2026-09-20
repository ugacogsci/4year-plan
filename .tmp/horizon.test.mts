import { readHorizon } from '/Users/michaelcrews/THE ADVISOR/planner/components/planner/illinois-source.tsx';
const START = { season: 'Fall' as const, year: 2026 };
const cases: Array<[string, string]> = [
  ['Incoming freshman starting fall 2026, zero college credit. Want to finish in four years.', 'Spring 2030'],
  ['starting fall 2026', 'Spring 2030'],
  ['Second year, about 30 credits done. I want to graduate spring 2030.', 'Spring 2030'],
  ['I want to graduate in spring 2029', 'Spring 2029'],
  ['Transferred in fall 2026, hoping to be done by spring 2029', 'Spring 2029'],
  ['sophomore, graduating 2029', 'Spring 2030'],
  ['I started fall 2025 and want to finish fall 2029', 'Fall 2029'],
  ['no idea honestly', 'Spring 2030'],
  ['finish in 3 years', 'Spring 2029'],
  ['graduate spring 2026', 'Spring 2030'],
];
let bad = 0;
for (const [text, want] of cases) {
  const h = readHorizon(text, START);
  const got = `${h.gradSeason} ${h.gradYear}`;
  const ok = got === want;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  start ${String(h.startSeason + ' ' + h.startYear).padEnd(11)} grad ${got.padEnd(12)} stated=${String(h.stated).padEnd(5)} "${text.slice(0, 58)}"`);
}
console.log(bad ? `*** ${bad} FAILURES ***` : `all ${cases.length} correct`);
