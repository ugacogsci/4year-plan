#!/usr/bin/env node
/**
 * Copy the original semantic-course-map PaCMAP projection into the planner's
 * catalog. The source scrape stays read-only; this project owns the normalized
 * 0-100 positions it writes to public/uga-catalog.json.
 *
 * A small number of catalog rows are newer than the checked-in PaCMAP file.
 * Those are placed near the centroid of their subject so every current course
 * still appears without pretending it had an embedding in the older snapshot.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SOURCE = join(
  ROOT,
  '..',
  'semantic-course-map',
  'frontend',
  'public',
  'data',
  'database_mapped_pacmap_o.json',
);
const CATALOG = join(ROOT, 'public', 'uga-catalog.json');

const source = JSON.parse(readFileSync(SOURCE, 'utf8'));
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
const xs = source.map((row) => Number(row.x));
const ys = source.map((row) => Number(row.y));
const minX = Math.min(...xs);
const maxX = Math.max(...xs);
const minY = Math.min(...ys);
const maxY = Math.max(...ys);
const normalize = (value, low, high) => 3 + ((value - low) / (high - low)) * 94;
const round = (value) => Math.round(value * 100) / 100;
const key = (subject, number) => `${subject} ${number}`.replace(/\s+/g, ' ').trim().toUpperCase();

const positions = new Map();
const centroids = new Map();
for (const row of source) {
  const point = {
    x: normalize(Number(row.x), minX, maxX),
    y: normalize(Number(row.y), minY, maxY),
  };
  positions.set(key(row.subject, row.number), point);
  const bucket = centroids.get(row.subject) ?? { x: 0, y: 0, count: 0 };
  bucket.x += point.x;
  bucket.y += point.y;
  bucket.count += 1;
  centroids.set(row.subject, bucket);
}

const hash = (text) =>
  Array.from(text).reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 17);
let embedded = 0;
let placedBySubject = 0;
for (const course of catalog) {
  const direct = positions.get(key('', course.code));
  if (direct) {
    course.mapPosition = { x: round(direct.x), y: round(direct.y) };
    embedded += 1;
    continue;
  }
  const subject = course.code.split(/\s+/, 1)[0];
  const centroid = centroids.get(subject);
  if (!centroid) continue;
  const seed = hash(course.code);
  const angle = ((seed % 360) * Math.PI) / 180;
  const radius = 0.45 + ((seed >>> 9) % 160) / 100;
  course.mapPosition = {
    x: round(Math.min(97, Math.max(3, centroid.x / centroid.count + Math.cos(angle) * radius))),
    y: round(Math.min(97, Math.max(3, centroid.y / centroid.count + Math.sin(angle) * radius))),
  };
  placedBySubject += 1;
}

writeFileSync(CATALOG, JSON.stringify(catalog));
console.log(
  `PaCMAP positions applied: ${embedded.toLocaleString()} embedded, ` +
  `${placedBySubject.toLocaleString()} newer courses placed by subject, ` +
  `${catalog.length.toLocaleString()} total.`,
);
