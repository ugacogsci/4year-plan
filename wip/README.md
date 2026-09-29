# Work in progress, parked on this branch

The two engine packages once parked here as patches are merged: faster
rebuilds (every board unchanged, proved by the sweep) and the filler rules
(behind the gate's second pass; see "Year one and the gate" in the main
README). What is left is the syllabus scraper.

The syllabus scraper in `scripts/illinois/syllabi/` is unfinished: its
fetcher, robots, cache, catalog, terms and text libraries and the PDF helper
exist; classification, fact parsing, course matching, the source adapters, the
crawl and the build of `public/illinois/syllabi.json` do not. Its design (32
public sources, coverage estimates, run plan) came from a research pass;
`import-research.mjs` expects that pass's downloads, which lived only on the
Mac that ran it, so on a fresh machine skip it and let the crawl fetch them.
Canvas is excluded until the student decides; Box files are listed, never
downloaded.

Delete this folder once the scraper is finished or dropped.
