import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bucketMapCourses, hitTestMap, MAP_STICKY_HIT_RADIUS } from './map-hit-testing.ts';
import { splitCourseMentions } from './course-mentions.ts';

const course = (id, code = id, cluster = 'test') => ({ id, code, cluster });

function fixture(points, k = 1, viewport = { width: 800, height: 500 }) {
  const plane = { width: 900, height: 1250 };
  const origin = { x: -80, y: -370 };
  const view = { k, x: -100, y: 40 };
  const courses = points.map(([id]) => course(id));
  const positions = new Map(points.map(([id, x, y]) => [id, {
    x: ((x - origin.x - view.x) / k / plane.width) * 100,
    y: ((y - origin.y - view.y) / k / plane.height) * 100,
  }]));
  const options = { view, origin, plane, viewport, positions,
    buckets: bucketMapCourses(courses, positions), hidden: new Set(), priorityIds: new Set(['selected', 'planned']) };
  return (x, y, overrides = {}) => hitTestMap({ ...options, pointer: { x, y }, ...overrides })?.course.id ?? null;
}

for (const zoom of [1, 4, 12, 24]) {
  for (const width of [320, 1200]) {
    test(`sticky selection uses screen pixels at zoom ${zoom}, width ${width}`, () => {
      const hit = fixture([['selected', 200, 200], ['regular', 213, 200]], zoom, { width, height: 400 });
      assert.equal(MAP_STICKY_HIT_RADIUS, 14, 'the sticky diameter is one quarter of the previous 112 pixels');
      assert.equal(hit(213, 200), 'selected');
      assert.equal(hit(200 + MAP_STICKY_HIT_RADIUS - 0.5, 200), 'selected');
      assert.equal(hit(200 + MAP_STICKY_HIT_RADIUS + 1, 200), 'regular');
      assert.equal(hit(210, 214), 'regular', 'the priority target is circular, not a square');
      assert.equal(hit(240, 200), null, 'the old enlarged target no longer captures clicks');
    });
  }
}

test('the closest priority node wins, even over a closer ordinary node', () => {
  const hit = fixture([['selected', 100, 200], ['planned', 120, 200], ['regular', 114, 200]]);
  assert.equal(hit(114, 200), 'planned');
  assert.equal(hit(105, 200), 'selected');
});

test('empty map space still dismisses selection and hidden/offscreen nodes cannot capture', () => {
  const hit = fixture([['selected', -10, 200], ['planned', 200, 200]]);
  assert.equal(hit(10, 200), null);
  assert.equal(hit(600, 200), null);
  assert.equal(hit(200, 200, { hidden: new Set(['test']) }), null);
  assert.equal(hit(-1, 200), null);
});

test('arrange mode keeps exact node targeting instead of magnetizing a nearby selection', () => {
  const hit = fixture([['selected', 200, 200], ['regular', 245, 200]]);
  assert.equal(hit(245, 200, { sticky: false }), 'regular');
  assert.equal(hit(200, 245, { sticky: false }), null);
});

const byCode = new Map(['CS 124', 'CS 128', 'CS 173', 'MATH 221', 'MATH 231',
  'CSCI 1301', 'CSCI 1302', 'BIOL 1107L', 'PHYS 1211L'].map((code) => [code, course(code.replaceAll(' ', '-'), code)]));
function links(text) {
  const parts = splitCourseMentions(text, byCode);
  assert.equal(parts.map((part) => part.text).join(''), text, 'warning wording must remain unchanged');
  return parts.filter((part) => part.course).map((part) => part.course.code);
}

test('UGA, Illinois, suffixes, repeated references, whitespace and compact codes link', () => {
  assert.deepEqual(links('CSCI 1302 needs CSCI1301. CSCI 1302 and BIOL 1107L; PHYS-1211L.'),
    ['CSCI 1302', 'CSCI 1301', 'CSCI 1302', 'BIOL 1107L', 'PHYS 1211L']);
  assert.deepEqual(links('cs 124 needs MATH\u00a0221.'), ['CS 124', 'MATH 221']);
});

test('shorthand prerequisite lists link, but course ranges and dates are not invented', () => {
  assert.deepEqual(links('CS 124, 128 or 173; MATH 221 and 231.'), ['CS 124', 'CS 128', 'CS 173', 'MATH 221', 'MATH 231']);
  assert.deepEqual(links('MATH 221-231, Spring 2027, 120 credits.'), ['MATH 221']);
  assert.deepEqual(links('CS 124 is offered in 2027. Earn 128 credits.'), ['CS 124']);
});

test('unavailable and partial codes remain plain text', () => {
  assert.deepEqual(links('CS 1240, MATH 999, XCS 124 and BIOL 1107LE.'), []);
  assert.deepEqual(links('No course mentioned here.'), []);
});
