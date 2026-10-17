import { parseHTML } from 'linkedom';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIRECTORY = 'https://doubledawgs.uga.edu/ProgramList';
const clean = (value) => value.replace(/\s+/g, ' ').trim();
const key = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Only named course links in the sample table, never the requirement pools above it. */
export function parseSamplePlan(html, program) {
  const { document } = parseHTML(html);
  // The Bulletin repeats this id on navigation links as well as the content.
  const section = document.querySelector('.degree-card#FourYear');
  if (!section) return null;
  const terms = [];
  let term = null;
  let variant = program.name;
  for (const element of section.querySelectorAll('h6, table')) {
    if (element.tagName === 'H6') {
      const label = clean(element.textContent);
      if (/\b(?:fall|spring|summer)\b/i.test(label)) {
        term = { label, variant, courseCodes: [] };
        terms.push(term);
      } else if (!/four.year program of study/i.test(label)) {
        variant = label;
        term = null;
      }
      continue;
    }
    if (!term) continue;
    for (const row of element.querySelectorAll('tr')) {
      const cell = row.querySelector('td');
      for (const link of cell?.querySelectorAll(
        'a[href*="/Course/Details/"]',
      ) ?? []) {
        const match = clean(link.textContent).match(
          /^([A-Z]{2,5})(?:\([A-Z]{2,5}\))*\s+(\d{4}[A-Z]?)(?:[/-](\d{4}[A-Z]?))?/,
        );
        if (!match) continue;
        for (const number of [match[2], match[3]].filter(Boolean)) {
          const code = `${match[1]} ${number}`;
          if (!term.courseCodes.includes(code)) term.courseCodes.push(code);
        }
      }
    }
  }
  const courseCodes = [...new Set(terms.flatMap((term) => term.courseCodes))];
  if (!courseCodes.length) return null;
  return {
    programId: program.id,
    programName: program.name,
    url: `https://bulletin.uga.edu/Program/Details/${program.id}#Four-Year%20Program%20of%20Study`,
    courseCodes,
    terms,
  };
}

export function parsePathways(html, programs) {
  const { document } = parseHTML(html);
  const pathways = new Map();
  for (const link of document.querySelectorAll(
    'td.showDetails a[href*="ProgramPopup/"]',
  )) {
    const id = link.getAttribute('href')?.match(/ProgramPopup\/(\d+)/)?.[1];
    const name = clean(link.textContent);
    const [bachelors, ...rest] = name.split('/');
    if (!id || !rest.length) continue;
    const graduate = rest.join('/').trim();
    // Match the exact degree name, retaining emphasis/thesis qualifiers in the visible pathway.
    // A similar subject or a different degree code does not establish a pairing.
    const undergraduateProgramIds = programs
      .filter((p) => key(p.name) === key(bachelors.split('(')[0]))
      .map((p) => p.id);
    const graduateProgramIds = programs
      .filter((p) => key(p.name) === key(graduate.split('(')[0]))
      .map((p) => p.id);
    pathways.set(id, {
      id,
      name,
      bachelors: bachelors.trim(),
      graduate,
      undergraduateProgramIds,
      graduateProgramIds,
      url: `https://doubledawgs.uga.edu/ProgramDetails/${id}`,
    });
  }
  return [...pathways.values()];
}

async function get(url) {
  const cache = join(
    tmpdir(),
    `orion-uga-guidance-${new Date().toISOString().slice(0, 10)}`,
  );
  await mkdir(cache, { recursive: true });
  const path = join(
    cache,
    `${new URL(url).pathname.replace(/[^a-z0-9]/gi, '-')}.html`,
  );
  if (!process.argv.includes('--refresh')) {
    try {
      return await readFile(path, 'utf8');
    } catch {
      /* Fetch on the first run today. */
    }
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const html = await response.text();
  await writeFile(path, html);
  return html;
}

async function main() {
  const root = new URL('../', import.meta.url);
  const { programs } = JSON.parse(
    await readFile(new URL('public/uga-programs.json', root), 'utf8'),
  );
  const pathways = parsePathways(await get(DIRECTORY), programs);
  if (pathways.length < 100)
    throw new Error('Unexpectedly few pathways; retaining the previous data.');
  const undergraduate = programs.filter(
    (p) => p.degree === 'AB' || /^B[A-Z]+$/.test(p.degree),
  );
  const samplePlans = [];
  const withoutSamplePlan = [];
  for (const [index, program] of undergraduate.entries()) {
    const sample = parseSamplePlan(
      await get(`https://bulletin.uga.edu/Program/Details/${program.id}`),
      program,
    );
    if (sample) samplePlans.push(sample);
    else withoutSamplePlan.push(program.id);
    if (index % 20 === 0)
      console.log(`Read ${index + 1}/${undergraduate.length} Bulletin pages`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (samplePlans.length < 20)
    throw new Error(
      'Unexpectedly few sample plans; retaining the previous data.',
    );
  const data = {
    fetchedAt: new Date().toISOString(),
    pathwaySource: DIRECTORY,
    pathways,
    samplePlans,
    withoutSamplePlan,
  };
  await writeFile(
    new URL('public/uga-planning-guidance.json', root),
    `${JSON.stringify(data, null, 2)}\n`,
  );
  console.log(
    `${samplePlans.length} sample plans; ${pathways.length} Double Dawgs pathways; ${pathways.filter((p) => p.undergraduateProgramIds.length).length} matched to catalog majors.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
