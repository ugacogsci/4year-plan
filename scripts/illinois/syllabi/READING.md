# The reading pass: syllabus excerpts into facts

`excerpt.mjs` writes `data/syllabi/state/excerpts/batch-NNN.txt`, fifteen
documents each. A model reads each batch and returns one fact record per
document; `store-facts.mjs` keeps the records, and `build.mjs` writes the
shards ALMA reads.

## Running it

1. Crawl, then cut excerpts for documents that have no facts yet:
   `node scripts/illinois/syllabi/crawl.mjs --sources …`, then
   `node scripts/illinois/syllabi/excerpt.mjs --batch 15`. Add `--all` to
   read every document again after the rules change.
2. Run the reading pass over the batches. It is a Claude Code workflow: one
   reader per batch (Sonnet), and a stronger checker that re-reads four
   documents of every fourth batch against the extracted facts. The reader's
   instructions are below, and its output schema is the field list in
   `store-facts.mjs` and `build.mjs`.
3. `node scripts/illinois/syllabi/store-facts.mjs <the workflow's journal.jsonl>`.
   Run it before the next `excerpt.mjs`, which replaces the batch files that
   store-facts reads each document's source and URL from.
4. `node scripts/illinois/syllabi/build.mjs`.

## What the checkers found

- **First pass (Haiku, short excerpts):** the grading was right on 15 of 20
  sampled syllabi.
  - Excerpts cut at 7,000 characters lost the "Final grade" table at the end
    of long syllabi.
  - Bonus points were counted in the total.
  - Final-exam fields restated the weight or invented "see the schedule".
- **Second pass (Sonnet, 12,000-character excerpts that keep the breakdown
  first, the rules below):** 23 of 24 right.
  - The misses were small: a qualifier carried from one policy to another
    when two were merged, and a term written "Spring 26".

## The reader's rules

The reader turns university course syllabi into facts a student can ask
about. A student relies on these numbers, so accuracy matters more than
completeness.

Return one entry for EVERY document in the batch, with its sha, in file
order.

**kind**
- `syllabus`: a full syllabus for a course and term or section.
- `course-policy`: a policy or information sheet for one course.
- `master-outline`: topics and objectives, with no grading.
- `course-page`: a catalog-like description.
- `other`: not about one course.

**codes**: the course codes the document is for, in the form "SUBJ 123".
Start from the course hint and add the cross-listed codes the text names. Do
not add courses it only mentions, such as prerequisites.

**instructors**: names only. Use `[]` when none is named; never a
placeholder.

**Grading**
- Facts only from the text, and never guess a number.
- `gradingBasis` is `percent` or `points` only when the text shows it. Use
  `pass-fail` for S/U or pass/fail, and `unknown` when the text does not say.
- `gradingComponents`: every graded item, in the document's wording where
  short, with its weight as stated, or null when no weight is given. Include
  ungraded but required items (S/U assignments) with weight null and a note.
- Extra credit and bonus points are never a component and are never counted
  in `pointsTotal`; describe them only in `extraCredit`.
- `pointsTotal` is the base total the syllabus states, without bonus.
- Keep qualifiers that change meaning, word for word: "approximately", "at
  least", "up to", "per part", "best 16 of 18".
- When the document contradicts itself, use the table's figures and say so
  in `notes`.

**Exams and the final**
- `exams`: every exam, midterm or test the document names, each with its
  date or week as written. Use `when: null` when no date is given. Record
  what an exam covers only when the text says so.
- `finalExam`: what the document says about the final (its date, time,
  whether it is cumulative, its format). Do not restate its weight. Use null
  when there is no final, or when nothing beyond its weight is said.

**Materials**: every listed item, up to 8. `required` is true only when the
text says required, false when it says recommended, optional or
supplementary, and null when it does not say.

**Policies**
- `attendance`: any attendance or participation expectation goes here.
- `lateWork`, `makeups`: concrete numbers.
- `other`: up to four concrete rules, preferring ones that affect the grade
  (integrity penalties, AI-use rules, lab requirements). Leave out vague
  filler.

Everything goes in the reader's own short words, within each field's limit;
never whole copied sentences. Leave out emails, phone numbers and student
information.

**confidence**: `low` when the excerpt is cut or the table came through
jumbled; say what is missing in `notes`.
