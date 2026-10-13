# The reading pass: club descriptions into facts

`batches.mjs` writes `data/clubs/reading/batch-NNN.txt`, 25 clubs each: the
club's name, its directory categories, and its own mission and membership
benefits text. A model reads each batch and returns one fact record per club.
`store-facts.mjs` checks the records and keeps them in
`scripts/illinois/clubs/facts.json`, and `build.mjs` joins them into
`public/illinois/clubs.json`.

It needs the owner's go-ahead (DESIGN decision 3). Without it, v1 ships on
list, national, name and major evidence only: no `does` lines, and kinds come
from names and categories. Nothing here runs a model by itself.

## Running it

1. Crawl and tag: `node scripts/illinois/clubs/crawl.mjs` (or `--offline`),
   then `node scripts/illinois/clubs/tag.mjs`.
2. `node scripts/illinois/clubs/batches.mjs`. It writes batches only for
   clubs whose text changed since `facts.json` (its `hash` differs), or that
   were never read. The first run reads every club the build would ship:
   1,067 clubs in 43 batches on the 2026-10-04 directory. Later runs usually
   read a few dozen. `--all` reads every club again after these rules change;
   `--include-dropped` also reads the groups the name rules dropped as
   graduate, law, medical or veterinary, to check those rules.
3. Run the reading pass over the batches. It is a Claude Code workflow: one
   reader per batch (Sonnet), each returning
   `{ "clubs": [ { id, hash, kind, identity, audience, joining, goals, does } ] }`
   for its batch, every club in file order.
4. `node scripts/illinois/clubs/store-facts.mjs <the workflow's journal.jsonl>`
   (`--dry-run` first to see what it would keep). Run it before the next
   `batches.mjs`, which replaces `data/clubs/reading/index.json`, the record
   of which text each batch carried.
5. The check: `node scripts/illinois/clubs/batches.mjs --check 40` writes
   `data/clubs/reading/check.txt`: 40 clubs already read (20 with goals, 10
   marked graduate, unclear or selective, 10 at random), each club's text
   beside what was stored. A stronger model than the reader grades it, by the
   checker's rules below. Fix what it finds in `overrides.json` (by id, with a
   note) or by reading those clubs again.
6. `node scripts/illinois/clubs/build.mjs`.

What it costs: about 544,000 characters of club text on the first run, about
167,000 input tokens across the 43 readers before their instructions, plus
one checker call over 40 clubs. A refresh reads only changed clubs.

The club texts in `data/clubs/` stay local (its `.gitignore` is `*`): the
clubs own their words. `facts.json` is committed and holds only our words and
ids.

## The reader's rules

The reader turns a student organization's own description into facts the
planner uses to recommend clubs to undergraduates. A wrong fact sends a
student to a club they cannot join, so when the text does not say, answer
`unclear` rather than guess.

Return one entry for EVERY club in the batch, with its `id` and `hash` copied
exactly, in file order. Take each hash from the line under that club's own
id: on 2026-10-05 a reader shifted hashes by one club through half a batch,
and `store-facts.mjs` refused all 19. Use only the values listed at the top
of the batch.

**kind**: what the club mainly is.
- `pre-professional`: prepares members for a professional school (pre-med,
  pre-law, pre-vet, pre-PT ...).
- `professional-society`: a student chapter of a professional body (ASME,
  IEEE, ACM, AMA, NSBE) or a club for careers in one field.
- `competition-team`: builds, codes or argues for competitions (solar car,
  robotics, mock trial, moot court, Model UN, case competitions).
- `professional-fraternity`: a Greek-letter organization for a profession or
  field, with rush or recruitment.
- `honor`: membership comes by GPA, class standing or invitation, and the text
  says so. A club that is merely selective is not an honor society.
- `consulting-investing`: does consulting projects for clients, or manages or
  pitches investments.
- `academic`: about a field of study, without the above (a department's
  student association, a research or reading club, an undergraduate journal).
- `service`: volunteering, philanthropy, mentoring or tutoring as the main
  activity.
- `arts-performance`: performs or makes art (music, dance, theater, a
  cappella, comedy).
- `media`: publishes or broadcasts (a newspaper, magazine, radio, video).
- `government-advocacy`: student government, political or advocacy groups.
- `cultural`: centered on a culture, nationality or heritage.
- `faith`: centered on a religion or spiritual practice.
- `sport-recreation`: plays a sport or an outdoor or recreational activity.
- `social`: mainly social, a hobby, or a housing community.
- `greek-social`: a social fraternity or sorority.
- `other`: none of these fits.

**identity**: `true` when the club is centered on a shared identity or
background of its members (a culture, ethnicity, gender, sexuality, faith,
first-generation status, veterans), including professional groups for one
community (Society of Women Engineers, NSBE, ALPFA). Otherwise `false`. This
describes the club, never a student.

**audience**: who can join, decided from the text, never from the directory
category alone.
- `undergrad`: undergraduates can join (the usual case, and the answer when
  nothing says otherwise).
- `both`: the text says undergraduate and graduate students.
- `grad`, `law`, `med`, `vet`: only students already in a graduate program, the
  College of Law, a medical school (Carle Illinois) or the College of
  Veterinary Medicine. A pre-law, pre-med or pre-vet club is `undergrad`.
- `unclear`: the text suggests graduate or professional students but does not
  say who can join.

**joining**: how members join, from the text.
- `open`: anyone may join (the usual case, and the answer when nothing says
  otherwise).
- `application`, `audition`, `election`, `invitation`: the text says members
  apply, audition, are elected or are invited. A recruitment or rush period
  alone is not an application.
- `unclear`: the text hints at selection but does not say how.

**goals**: zero or more ids from the list in the batch header, only for career
goals the club is plainly about: its activities prepare members for that kind
of work or study. Not for a word that merely appears ("laws of physics" is not
law; a fraternity that "builds leaders" is not entrepreneurship). Social,
Greek, faith, cultural and sport clubs get no goals. A club for pre-health
students in general gets every health track but pre-veterinary, plus
nursing, not pre-medicine alone; a club for one community (women, Latino
students) still gets the goals its activities serve. The build keeps a goal
only where one of the club's own directory categories agrees with it, so a
stray one does no harm, but leave it out anyway.

**does**: one plain sentence in your own words, at most 20 words and 140
characters, saying what members do. No marketing language ("premier",
"empowering"), no claims about outcomes, dues, meeting times or selectivity,
no names, emails or numbers. Never copy: no run of 8 or more words may match
the club's text, and `store-facts.mjs` drops a line that does. Leave it out
(null) when the text does not say what members do.

## The checker's rules

The checker is a stronger model than the reader. It gets `check.txt`: each
club's text and the facts stored for it. For each club it answers:

- `goalsRight`: is every stored goal one the club's own text is plainly about?
  Name each wrong goal and each clear goal that is missing.
- `undergradRight`: can an undergraduate join, by the club's own words?
- `kindRight`, `identityRight`, `joiningRight`: as the reader's rules define
  them.
- `doesTrue`: does `does` state only what the text says? `copied`: does any
  run of 8 or more words come from the text?

It returns `{ run, checker, clubs: [{ id, goalsRight, wrongGoals,
missedGoals, undergradRight, kindRight, identityRight, joiningRight, doesTrue,
copied, note }] }`. The goal-tagging and audience accuracy it measures are
the "true facts" numbers reported after every rebuild.

## What the checkers found

After each run, add a dated bullet here: how many of the 40 clubs had every
fact right, and the one or two most common mistakes.

- **2026-10-05**, first full pass (1,067 clubs, 43 Sonnet readers), checked
  by Opus over the 40-club sample (seed 2026-10-04; grades in
  `data/clubs/reading/check-grades.json`). **35 of 40 had every fact
  right.** Kind and audience 40 of 40, identity 39, joining 38, goals 38; all
  38 `does` lines true, none copied (the longest shared run was 6 words).
  The mistakes: goals left out (a general pre-health club given pre-medicine
  only; health care management not given public health), joining off by one
  step (an honors society marked open, a welcoming club marked unclear from
  the OneIllinois flag alone; neither ships), and one program for students
  from under-represented groups not marked identity. Store step: 1,031 of
  1,067 entries kept at first. 36 were refused because the reader copied the
  wrong hash, shifted by one club through a run of a batch (19 in batch 12,
  8 in batch 19), while the facts were for the right club; 39 `does` lines
  were left out (33 over 20 words or 140 characters, 6 with an 8-word run).
  All 77 were checked by hand against the text and stored again from a
  corrections file: 1,067 facts, 1,033 with `does`. Beyond the sample, the
  general pre-health miss repeated in 6 more clubs, and 2 clubs plainly for
  undergraduates (Latinx in Law, Student Academy of Audiology) were marked
  unclear and dropped off the rail; `overrides.json` has 13 rows dated
  2026-10-05 for all of these. Watch next time: a reader's kind can strip a
  club's name goals (Retrocomputing and Hardware, social; the Latine Social
  Work Organization, cultural), and a club whose category kind is asked-only
  keeps its goals held back even when the reader's kind is not (Hearts in
  Practice needed `kind` in its override).
