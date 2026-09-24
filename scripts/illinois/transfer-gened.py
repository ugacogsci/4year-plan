"""
Which Illinois general education categories a transfer course fills, from
the published guides that say so.

Parkland College and the University of Illinois Office of Undergraduate
Admissions publish "Parkland College Course Equivalencies for General
Education Requirements at the University of Illinois Urbana-Champaign" each
year. It names, per Illinois gen-ed category, the Parkland courses that meet
it. That is the university's own statement for the college that sends it the
most transfer students, and it is what lets a plan stop booking Humanities for
a student who already took Parkland's HUM 101.

The guide lists categories, not Illinois course numbers, so the output is
categories: the plan counts the course's hours toward the total and toward the
categories, and books nothing for them. Two rules are carried as the guide
states them: Composition I is met by ENG 101 paired with ENG 102, and a lab
course listed as "paired with" a lecture counts only with it.

Codes in the PDF carry footnote digits glued to the number ("SPA 1041" is SPA
104, footnote 1; "CHE 14210" is CHE 142, footnote 10). Parkland numbers are
three digits, so the first three are the number.

    /usr/local/bin/python3 scripts/illinois/transfer-gened.py
Output: public/illinois-transfer-gened.json
"""
import json, re, sys, urllib.request, io, os

SOURCE = 'https://www.parkland.edu/Portals/3/Transfer/Documents/2024-2025%20Parkland%20to%20UIUC%20GE%20course%20equivalencies.pdf?ver=DgXlqgtxYMTV3ZK-lWLkTw%3D%3D'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'public', 'illinois-transfer-gened.json')
CACHE = os.path.join(HERE, '..', '..', 'data', 'parkland-uiuc-ge.pdf')

import pdfplumber

if not os.path.exists(CACHE):
    req = urllib.request.Request(SOURCE, headers={'User-Agent': 'Mozilla/5.0 (student planner; contact via GitHub)'})
    data = urllib.request.urlopen(req, timeout=60).read()
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    open(CACHE, 'wb').write(data)

text = ''
with pdfplumber.open(CACHE) as pdf:
    for page in pdf.pages:
        text += (page.extract_text() or '') + '\n'

effective = re.search(r'Effective (\d{2}/\d{2}/\d{4})\s*[–-]\s*(\d{2}/\d{2}/\d{4})', text)

# Section headings in the order the guide prints them, and the tags each gives.
SECTIONS = [
    (r'^COMPOSITION I\b', ['Composition I']),
    (r'^ADVANCED COMPOSITION\b', ['Advanced Composition']),
    (r'^LANGUAGE REQUIREMENT', ['@language']),
    (r'^CULTURAL STUDIES: NON-WESTERN', ['Cultural Studies - Non-West']),
    (r'^CULTURAL STUDIES: US MINORITY', ['Cultural Studies - US Minority']),
    (r'^CULTURAL STUDIES: WESTERN', ['Cultural Studies - Western']),
    (r'^SOCIAL & BEHAVIORAL SCIENCES', None),
    (r'^Behavioral Sciences$', ['Social & Beh Sci - Beh Sci']),
    (r'^Social Sciences$', ['Social & Beh Sci - Soc Sci']),
    (r'^HUMANITIES & THE ARTS', None),
    (r'^Historical and Philosophical Perspectives', ['Humanities - Hist & Phil']),
    (r'^Literature and the Arts', ['Humanities - Lit & Arts']),
    (r'^NATURAL SCIENCES & TECHNOLOGY', None),
    (r'^Life Sciences$', ['Nat Sci & Tech - Life Sciences']),
    (r'^Physical Sciences$', ['Nat Sci & Tech - Phys Sciences']),
    (r'^QUANTITATIVE REASONING I\b(?! I)', ['Quantitative Reasoning I']),
    (r'^QUANTITATIVE REASONING II\b', ['Quantitative Reasoning II']),
    (r'^Courses that haven', ['@legacy']),
]
LEGACY = {
    'Physical Science': ['Nat Sci & Tech - Phys Sciences'],
    'Social Science': ['Social & Beh Sci - Soc Sci'],
    'Quantitative Reasoning I': ['Quantitative Reasoning I'],
    'Historical/Philosophical Perspectives': ['Humanities - Hist & Phil'],
    'Literature & the Arts': ['Humanities - Lit & Arts'],
    'Non-Western': ['Cultural Studies - Non-West'],
    'Western Culture': ['Cultural Studies - Western'],
    'US Minority': ['Cultural Studies - US Minority'],
}
CODE = re.compile(r'\b([A-Z]{3}) (\d{3})\d{0,2}\b')

courses = {}
pairs = []
language = {}
current = None
for raw in text.split('\n'):
    line = raw.strip()
    if not line:
        continue
    hit = next((tags for pat, tags in SECTIONS if re.search(pat, line)), 'none')
    if hit != 'none':
        current = hit
        continue
    if current is None or re.match(r'^\d+\s', line) or line.startswith('•') or 'Effective' in line:
        continue  # footnotes and page footers
    if current == ['@legacy']:
        m = re.match(r'^([A-Z]{3}) (\d{3})\s*[-–]\s*(.+?)\s{1,}(Humanities|Physical|Social|Quantitative|Western|Non-Western|US Minority)(.*)$', line)
        if m:
            tags = []
            rest = (m.group(4) + m.group(5))
            for label, t in LEGACY.items():
                if label in rest:
                    tags += t
            code = f'{m.group(1)} {m.group(2)}'
            courses.setdefault(code, {'title': m.group(3).title(), 'tags': []})
            courses[code]['tags'] = sorted(set(courses[code]['tags'] + tags))
        continue
    if current is None:
        continue
    found = list(CODE.finditer(line))
    for i, m in enumerate(found):
        code = f'{m.group(1)} {m.group(2)}'
        end = found[i + 1].start() if i + 1 < len(found) else len(line)
        title = re.sub(r'\*?Paired w/.*$', '', line[m.end():end])
        title = re.sub(r'[*\d]+$', '', title).strip(' *')
        if code.startswith('ENG 10') or 'Paired' in title:
            pass
        if current == ['@language']:
            language[code] = title
            continue
        entry = courses.setdefault(code, {'title': title, 'tags': []})
        if len(title) > len(entry['title']):
            entry['title'] = title
        entry['tags'] = sorted(set(entry['tags'] + current))
    pm = re.search(r'\*Paired w/\s*([A-Z]{3}) (\d{3})', line)
    if pm:
        pairs.append(pm.group(0))

# The pairings the guide states in its own words.
PAIRED = [
    {'courses': ['ENG 101', 'ENG 102'], 'tags': ['Composition I'], 'why': 'Composition I (4-6 hours): ENG 101 English Composition I, paired with ENG 102 Composition II.'},
    {'courses': ['BIO 106', 'BIO 186'], 'tags': ['Nat Sci & Tech - Life Sciences'], 'why': 'BIO 186 Heredity and Society Lab, paired with BIO 106 Heredity and Society.', 'lab': 'BIO 186'},
    {'courses': ['PHY 120', 'PHY 129'], 'tags': ['Nat Sci & Tech - Phys Sciences'], 'why': 'PHY 129 How Things Work Laboratory, paired with PHY 120 How Things Work.', 'lab': 'PHY 129'},
]
# Composition I is a pair, never ENG 101 alone.
for code in ('ENG 101', 'ENG 102', 'ENG 106'):
    if code in courses:
        courses[code]['tags'] = [t for t in courses[code]['tags'] if t != 'Composition I']
        if not courses[code]['tags']:
            del courses[code]
# A lab listed as paired counts only with its lecture; its own entry carries no tags.
for p in PAIRED:
    lab = p.get('lab')
    if lab and lab in courses:
        del courses[lab]

LEVELS = {'101': 1, '102': 2, '103': 3, '104': 4, '111': 1}
lang = {code: {'title': t, 'semester': LEVELS.get(code.split(' ')[1]), 'language': {'SPA': 'Spanish', 'FRE': 'French', 'ASL': 'American Sign Language'}.get(code.split(' ')[0])} for code, t in language.items()}

out = {
    'source': SOURCE.split('?')[0],
    'title': 'Parkland College Course Equivalencies for General Education Requirements at the University of Illinois Urbana-Champaign',
    'editedBy': 'Office of Undergraduate Admissions, University of Illinois Urbana-Champaign, and Advising Services, Parkland College',
    'effective': f'{effective.group(1)} to {effective.group(2)}' if effective else None,
    'schools': [{
        'name': 'Parkland College',
        'match': ['parkland'],
        'courses': dict(sorted(courses.items())),
        'paired': PAIRED,
        'language': dict(sorted(lang.items())),
    }],
}
json.dump(out, open(OUT, 'w'), indent=1)
print(f'{len(courses)} Parkland courses with Illinois gen-ed categories, {len(lang)} language courses, effective {out["effective"]}')
