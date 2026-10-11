# Where Illinois syllabi are public (research pass, 2026-09-27)

`discovery.json` is the research pass behind the scraper: `results[]` holds seven
source sweeps (Course Explorer and the catalog, engineering, sciences,
humanities, the professional colleges, a 153-course web-search sample, and
LMS/archives), each with sources, how to enumerate them, robots.txt status,
login needs and sample URLs; `plan` holds the merged, ranked registry of 32
sources, the coverage estimate, the pipeline, the run order with times, the
PDF tooling found on the Mac, and what "100%" can and cannot mean.

`coverage-estimate.json` is every catalog course's best verdict from those
sweeps (current / older / archived only / partial / login only / none), built by
`merge.py`. It is an estimate for planning the crawl, not the crawl's result.

Findings in one line each: about 12% of the 6,110 catalog courses have a
current public syllabus and 19% any full syllabus; Grainger's public syllabus
store and the IB, MCB, Math and ECON libraries carry most of it; Canvas (almost
all private, and public pages are marked noindex) is excluded until the student
decides; Box folders are listed, never downloaded.
