import { readFileSync, writeFileSync } from 'node:fs';
const F = 'public/illinois-sections.json';
const d = JSON.parse(readFileSync(F, 'utf8'));
let dropped = 0, relifted = 0;
for (const c of d.courses) for (const s of c.sections) {
  const keep = (s.meetings ?? []).filter((m) => m.days || m.start || m.building);
  dropped += (s.meetings?.length ?? 0) - keep.length;
  s.meetings = keep;
  const first = keep[0];
  if (first && (s.start !== first.start || s.days !== first.days || s.building !== first.building)) {
    s.start = first.start; s.end = first.end; s.days = first.days;
    s.room = first.room; s.building = first.building;
    relifted++;
  }
}
writeFileSync(F, JSON.stringify(d));
const secs = d.courses.flatMap((c) => c.sections);
console.log(`dropped ${dropped} placeholder-only meetings, re-derived ${relifted} section headers`);
console.log('sections whose flat start is null while a meeting has a time:', secs.filter((s) => !s.start && (s.meetings ?? []).some((m) => m.start)).length);
