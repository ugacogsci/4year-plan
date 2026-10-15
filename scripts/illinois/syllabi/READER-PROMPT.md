# Reader instructions (one batch of syllabus excerpts -> one JSON file of facts)

You are reading one batch file of university course syllabus excerpts and turning each document into a fact record a student can rely on. Accuracy matters more than completeness: a student will act on these numbers, so never guess a number, a date or a rule. When the text does not say, use null.

## Input

The batch file is plain text. Each document starts with a line `=== DOCUMENT k of N ===`, then these header lines: `sha`, `source`, `url`, `course hint (from the store or URL)`, `term hint`, `section hint`, `title`, `full length`, then `--- HEADER (first lines of the document) ---` and `--- EXCERPT (passages about grading, exams, materials, policies) ---`. `[...]` marks a cut between passages; `[some passages left out]` means the excerpt hit its cap.

Course codes at Illinois look like "CHEM 102" (2-4 letters, 3 digits). Course codes at UGA look like "CHEM 1211", "CHEM 1211L", "AAEC 3580-3580L" or "CSCI 4720/6720" (4 letters, 4 digits, an optional letter, sometimes a paired lab or split-level twin). Use the form the document uses, uppercase, one space.

## Output

Write ONE JSON file at the output path you were given, shaped exactly like this, with one entry for EVERY document in the batch, in file order, each with its sha copied exactly:

```json
{ "docs": [ { ...record... }, ... ] }
```

A record:

```
sha               the document's sha, copied exactly
kind              "syllabus" | "course-policy" | "master-outline" | "course-page" | "other"
codes             ["CHEM 1211"]  course codes the document is FOR (start from the course hint; add cross-listed codes the text names; never add courses it only mentions, such as prerequisites)
term              the term the document itself names, as written ("Fall 2026"), or null
instructors       names only, as the document gives them, or []  (never a placeholder)
gradingBasis      "percent" | "points" | "letter-only" | "pass-fail" | "unknown"
gradingComponents [ { "item": "Exams (3)", "weight": 45, "unit": "percent", "note": "lowest dropped" }, ... ]
                  every graded item, in the document's wording where short; weight as stated or null; unit "percent" | "points" | "unknown";
                  required-but-ungraded items go in with weight null and a note; extra credit is NEVER a component
pointsTotal       the base points total the syllabus states, without bonus, or null
gradeScale        the letter-grade cutoffs as a short string ("A 90-100, B 80-89, ...") or null
curve             what the text says about curving, or null
dropPolicy        dropped-lowest rules, or null
extraCredit       what extra credit exists and how much, or null
exams             [ { "name": "Midterm 1", "when": "Week 5" | "Feb 12" | null, "note": "covers ch. 1-4" | null }, ... ]  every exam/midterm/test named; what it covers only when the text says
finalExam         what is said about the final beyond its weight (date, cumulative, format), or null
materials         [ { "item": "Chemistry: The Central Science, 15th ed.", "required": true | false | null }, ... ]  up to 8; required true only when the text says required, false for recommended/optional, null when it does not say
attendance        the attendance or participation expectation, or null
lateWork          the late-work rule, with its numbers, or null
makeups           the make-up rule, with its numbers, or null
other             up to 4 concrete rules that affect the grade (integrity penalties, AI-use rules, lab requirements); no vague filler
confidence        "high" | "medium" | "low"  (low when the excerpt is cut or a table came through jumbled)
notes             what is missing or contradictory, or null
```

## Rules

- **kind**: `syllabus` is a full syllabus for a course and term or section. `course-policy` is a policy or information sheet for one course. `master-outline` is objectives and topics with no grading. `course-page` is a catalog-like description. `other` is not about one course.
- **Facts only from the text.** Never fill in a weight, a date, a location or a rule the text does not give. Never restate the weight in `finalExam`. Never invent "see the schedule".
- **Keep qualifiers that change meaning**, word for word: "approximately", "at least", "up to", "per part", "best 16 of 18".
- **When the document contradicts itself**, use the table's figures and say so in `notes`.
- **Bonus points** are never counted in `pointsTotal` and never a component; describe them in `extraCredit` only.
- **Short words, your own.** Every string stays within a sentence or two. Never copy whole sentences from the document. Leave out emails, phone numbers, office locations and any student information.
- **Every document gets an entry**, even `other` ones (then most fields are null or empty).
- Valid JSON only in the output file: no comments, no trailing commas. Do not print the records in your reply; write the file, then reply with one line: how many documents, how many `syllabus` kind, and any document whose text looked unusable.
