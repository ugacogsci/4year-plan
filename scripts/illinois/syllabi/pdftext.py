"""
PDF to per-page text for the syllabus pipeline.

One process handles a whole batch: Node writes one JSON job per line to
stdin, {"in": ".../x.body", "out": ".../x.pdf.json"}, and this writes each
result file and prints one status line per job. Starting Python once per PDF
cost about 0.15 s each, which is most of the time for 3,500 files.

Engine: PyMuPDF (import pymupdf, 1.28.2 on this machine) reads a syllabus in
about 0.07 s. When it raises (a damaged xref, an odd encryption flag), pypdf
(6.9.2) gets a second try at about 0.6 s. Neither does OCR, so a scanned page
comes back nearly empty and text.mjs flags it "image-only" rather than
pretending it read something.

Text order: PyMuPDF's sort=True reads blocks top to bottom, left to right.
Grading tables in Word-made PDFs ("Homework ........ 20%") come out with the
label and the number on one line far more often that way; the default order
follows the content stream, which in the IB 150 syllabus put all the
percentages after all the labels.

Output: {"engine": "pymupdf", "pages": ["...", ...], "meta": {"title", "author",
"creationDate", "modDate"}, "error": null}
"""
import json
import sys


def with_pymupdf(path):
    import pymupdf

    doc = pymupdf.open(path)
    pages = [p.get_text("text", sort=True) for p in doc]
    m = doc.metadata or {}
    meta = {k: m.get(k) or None for k in ("title", "author", "creationDate", "modDate")}
    return {"engine": "pymupdf", "pages": pages, "meta": meta}


def with_pypdf(path):
    from pypdf import PdfReader

    r = PdfReader(path)
    pages = [(p.extract_text() or "") for p in r.pages]
    info = r.metadata or {}
    meta = {
        "title": info.get("/Title"),
        "author": info.get("/Author"),
        "creationDate": info.get("/CreationDate"),
        "modDate": info.get("/ModDate"),
    }
    return {"engine": "pypdf", "pages": pages, "meta": {k: (str(v) if v else None) for k, v in meta.items()}}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        job = json.loads(line)
        result = None
        errors = []
        for engine in (with_pymupdf, with_pypdf):
            try:
                result = engine(job["in"])
                break
            except Exception as e:  # noqa: BLE001 - any failure falls through to the next engine
                errors.append(f"{engine.__name__}: {e}")
        if result is None:
            result = {"engine": None, "pages": [], "meta": {}, "error": "; ".join(errors)}
        else:
            result["error"] = "; ".join(errors) or None
        with open(job["out"], "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False)
        print(json.dumps({"in": job["in"], "engine": result["engine"], "pages": len(result["pages"])}), flush=True)


if __name__ == "__main__":
    main()
