import { readFileSync, writeFileSync } from 'node:fs';
const F = 'public/illinois-sections.json';
const d = JSON.parse(readFileSync(F, 'utf8'));
const NO_ROOM = /^(n\.?a\.?|arr|arranged|location pending|tba|tbd|online|-)$/i;
const DESIG = /^((?:[A-Z]{0,3}-?[0-9][0-9A-Za-z-]*)(?:\/[0-9A-Za-z-]+)*|ARR|AUD|ARENA|LAB|RM|STU|THEAT)\s+(.+)$/i;
let moved = 0;
const fix = (o) => {
  if (!o.building) return;
  const m = o.building.match(DESIG);
  if (!m) return;
  const rest = m[2].trim();
  if (NO_ROOM.test(rest)) { o.building = null; o.room = null; moved++; return; }
  if (!o.room) o.room = NO_ROOM.test(m[1]) ? null : m[1];
  o.building = rest; moved++;
};
for (const c of d.courses) for (const s of c.sections) { fix(s); (s.meetings ?? []).forEach(fix); }
writeFileSync(F, JSON.stringify(d));
const secs = d.courses.flatMap((c) => c.sections);
const names = [...new Set(secs.flatMap((s)=>[s.building,...(s.meetings??[]).map(m=>m.building)]).filter(Boolean))];
console.log(`normalised ${moved} more location strings`);
console.log(`distinct buildings: ${names.length}`);
console.log('any still carrying a room?', names.filter((n) => /^[A-Z]{0,3}-?\d/i.test(n)).slice(0,4).join(' | ') || 'none');
