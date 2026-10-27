#!/usr/bin/env node
/**
 * Meaning vectors for the career pathways, so the career matcher can read a
 * short goal with what the career needs (lib/planner/career-embedding.ts
 * expandGoal): "dentist" alone is too little for the small model, which
 * found no course for it; "dentist" read with dentistry's skill areas finds
 * biochemistry, microbiology and anatomy.
 *
 * Input: the career research's pathways.json (54 pathways, each with its
 * goal words, summary and skill areas; the research lives outside the repo,
 * in the owner's keep-planner/career folder). Two vectors per pathway, with
 * the model the course vectors use (Xenova/all-MiniLM-L6-v2, float, mean
 * pooled, normalised), stored as 384 signed bytes and a scale, base64:
 *
 *   match  "<name>: <goal words, its variants' too>"   what a goal is compared with
 *   areas  "<summary> <core skill areas, comma separated>"   what the goal is read with
 *
 * A health pathway that no planner career track covers (`planner.careerTracks`
 * empty: the pre-health tracks already book a pre-med's or pre-vet's
 * sciences) also lists its science foundations: its core skills in the
 * natural sciences that its stages place before the advanced years, read
 * from the research's skills.json beside pathways.json, less the applied
 * ones (O*NET Food Production: "Food & nutrition science" read by its name
 * sits nearest food-science courses, FDST 1001 Careers in Food Science).
 * Nursing: human anatomy & physiology, microbiology & immunology, general
 * chemistry. Each such skill gets one vector of its name (`skills`), which
 * the matcher reads for those courses (career-embedding.ts careerFitFor).
 *
 * Output: public/career-pathways.json (about 65 KB), served beside the
 * course vectors. Run it again when pathways.json changes.
 *
 *   node scripts/career/embed-pathways.mjs <path to pathways.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const D = 384;
const source = process.argv[2] ?? process.env.CAREER_PATHWAYS;
if (!source) {
  console.error('usage: node scripts/career/embed-pathways.mjs <path to pathways.json>');
  process.exit(2);
}
const file = JSON.parse(readFileSync(resolve(source), 'utf8'));
const pathways = file.pathways;
const skillsById = new Map(JSON.parse(readFileSync(join(dirname(resolve(source)), file.skillsFile ?? 'skills.json'), 'utf8')).skills.map((s) => [s.id, s]));
const applied = (id) => (skillsById.get(id)?.onet ?? []).some((o) => o.type === 'knowledge' && o.name === 'Food Production');
/** A health pathway's core natural-science skills outside its advanced stage (years 3-4), in its own order, when no career track books them. */
export const foundationsOf = (p) => {
  if (p.family !== 'health' || (p.planner?.careerTracks ?? []).length > 0) return [];
  const advanced = new Set(p.stages?.advanced?.skills ?? []);
  return p.skills.filter((s) => s.priority === 'core' && skillsById.get(s.id)?.group === 'sci' && !advanced.has(s.id) && !applied(s.id));
};

export const matchText = (p) => `${p.name}: ${[...new Set([...p.goalWords, ...(p.variants ?? []).flatMap((v) => v.goalWords ?? [])])].join(', ')}`;
export const areasText = (p) => `${p.summary} ${p.skills.filter((s) => s.priority === 'core').map((s) => s.name).join(', ')}`;

const { pipeline, env } = await import('@huggingface/transformers');
env.allowRemoteModels = false;
const fe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { dtype: 'fp32' });

async function packed(texts) {
  const out = await fe(texts, { pooling: 'mean', normalize: true });
  return texts.map((_, i) => {
    let max = 0;
    for (let k = 0; k < D; k++) max = Math.max(max, Math.abs(out.data[i * D + k]));
    const scale = Number((max > 0 ? max / 127 : 1).toPrecision(6));
    const bytes = new Int8Array(D);
    for (let k = 0; k < D; k++) bytes[k] = Math.round(out.data[i * D + k] / scale);
    return { b64: Buffer.from(bytes.buffer).toString('base64'), scale };
  });
}

const match = await packed(pathways.map(matchText));
const areas = await packed(pathways.map(areasText));
const skills = [...new Map(pathways.flatMap(foundationsOf).map((s) => [s.id, s.name])).entries()].sort(([a], [b]) => (a < b ? -1 : 1));
const skillVectors = await packed(skills.map(([, name]) => name));
writeFileSync(join(ROOT, 'public/career-pathways.json'), JSON.stringify({
  model: 'Xenova/all-MiniLM-L6-v2', dims: D, pooling: 'mean', normalized: true,
  recipe: { match: '<name>: <goal words, variants included>', areas: '<summary> <core skill areas>', skills: '<skill name>' },
  from: `career research pathways.json, version ${file.version}, ${file.generated}`,
  attribution: file.onet?.attribution ?? null,
  license: file.onet?.license ?? null,
  pathways: pathways.map((p, i) => ({
    id: p.id,
    name: p.name,
    languages: p.skills.some((s) => s.priority === 'core' && s.id === 'foreign-language'),
    match: match[i].b64, matchScale: match[i].scale,
    areas: areas[i].b64, areasScale: areas[i].scale,
    ...(foundationsOf(p).length ? { foundations: foundationsOf(p).map((s) => s.id) } : {}),
  })),
  skills: skills.map(([id, name], i) => ({ id, name, vector: skillVectors[i].b64, scale: skillVectors[i].scale })),
}));
console.log(`${pathways.length} pathways, ${skills.length} science foundation skills -> public/career-pathways.json`);
