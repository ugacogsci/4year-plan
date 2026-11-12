/**
 * A transcript matched for one school, matched again for the other.
 *
 * A record is matched for the school picked when it was uploaded
 * (matchTranscript). A student who read their UGA transcript on the UGA board
 * and then switched to Illinois kept UGA's record: every line "taught here",
 * so on the Illinois board none went through Illinois's transfer check, the
 * UGA courses counted as bare hours, and the Intercollegiate Transfer note
 * for students already at Illinois showed (2026-11-04, the owner's test).
 * Both the setup screens and the board call this when the record's school is
 * not the board's (transcript.ts recordIsForOtherSchool).
 */
import { loadIllinoisIndex, setCourseleafSchool } from './illinois-load';
import { schoolById } from './onboarding';
import { courseleafOf, isCourseleaf, type SchoolKey } from './school-config';
import { loadTransferGenEd, type CatalogLite } from './transfer-match';
import { loadUgaTransfer } from './transfer-official';
import { loadGatechTransfer } from './transfer-gatech';
import { matchTranscript, normalizeCourseCode, readingOfRecord, type TranscriptRecord } from './transcript';
import type { Course } from './types';
import { loadUgaOfferings } from './uga-offerings';
import { refineTransfers } from './transfer-ai-client';

/**
 * `forced`: the caller re-matched a record that was never read for another
 * school (TOWER's update_setup coming_from, which flips schoolId to force the
 * re-read), so "first read when you planned for X" would name a school the
 * student never chose and is left out.
 */
export async function rematchForSchool(record: TranscriptRecord, here: SchoolKey, catalog: CatalogLite[], options?: { forced?: boolean }): Promise<TranscriptRecord> {
  const reading = readingOfRecord(record);
  // Illinois's gen-ed guide (Parkland, IAI) is Illinois's alone (school-config.ts transferGenEdGuide).
  const guide = courseleafOf(here)?.transferGenEdGuide ? await loadTransferGenEd().catch(() => null) : null;
  const ugaTable = here === 'uga' ? await loadUgaTransfer([reading.institution, ...reading.courses.map((c) => c.from)]).catch(() => null) : null;
  const crossListed = here === 'uga' ? (await loadUgaOfferings().catch(() => null))?.crossListed ?? null : null;
  // Georgia Tech's own transfer table (transfer-gatech.ts): nothing until its files and matcher exist.
  const gatechTable = here === 'gatech' ? await loadGatechTransfer([reading.institution, ...reading.courses.map((c) => c.from)]).catch(() => null) : null;
  const matched = matchTranscript(reading, record.fileName, catalog, record.files ?? [record.fileName], guide, here, ugaTable, crossListed, gatechTable);
  // Matched for this school, then the lines nothing settled decided (transfer-ai.ts), where the school has that step.
  const fresh = here === 'uga' || here === 'illinois' ? await refineTransfers(matched, catalog, here) : matched;
  const nameOf = (id: SchoolKey | undefined) => schoolById(id ?? 'illinois')?.short ?? 'another school';
  const was = nameOf(record.schoolId);
  return {
    ...fresh,
    readAt: record.readAt,
    notes: options?.forced ? fresh.notes : [`Checked again for ${nameOf(here)}: this record was first read when you planned for ${was}.`, ...fresh.notes],
    ...(record.currentConfirmed ? { currentConfirmed: record.currentConfirmed } : {}),
  };
}

/** The school's course list in the shape matching reads, as the upload loads it (transcript-upload.tsx catalogLite). */
export async function loadCatalogLite(here: SchoolKey): Promise<CatalogLite[]> {
  if (here === 'uga') {
    const url = schoolById('uga')?.catalog;
    if (!url) return [];
    const data = (await (await fetch(url)).json()) as Course[] | { courses?: Course[] };
    const courses = Array.isArray(data) ? data : Array.isArray(data?.courses) ? data.courses : [];
    return courses.filter((c) => typeof c?.code === 'string').map((c) => ({ code: normalizeCourseCode(c.code), title: c.title, credits: c.credits, level: Number(c.code.match(/\d/)?.[0] ?? 0) * 100, cluster: c.cluster, tags: c.tags }));
  }
  // The CourseLeaf loader serves one school at a time: point it at this one first.
  if (isCourseleaf(here)) setCourseleafSchool(here);
  const index = (await loadIllinoisIndex()) ?? [];
  return index.map((c) => ({ code: normalizeCourseCode(c.code), title: c.title, credits: c.credits, level: c.level, cluster: c.cluster, tags: c.tags, ...(c.repeat ? { repeat: c.repeat } : {}) }));
}
