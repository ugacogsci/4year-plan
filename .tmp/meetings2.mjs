import { readFileSync, writeFileSync } from 'node:fs';
const F = 'public/illinois-sections.json';
const d = JSON.parse(readFileSync(F, 'utf8'));
let n = 0;
for (const c of d.courses) for (const s of c.sections) {
  const m = (s.meetings ?? []).find((x) => x.start) ?? (s.meetings ?? [])[0];
  if (m && s.start !== m.start) {
    s.start = m.start; s.end = m.end; s.days = m.days; s.room = m.room; s.building = m.building; n++;
  }
}
writeFileSync(F, JSON.stringify(d));
const secs = d.courses.flatMap((c) => c.sections);
console.log(`re-derived ${n} more section headers`);
console.log('remaining mismatches:', secs.filter((s) => !s.start && (s.meetings ?? []).some((m) => m.start)).length);
console.log('sections with a clock time:', secs.filter((s) => s.start).length, 'of', secs.length);
