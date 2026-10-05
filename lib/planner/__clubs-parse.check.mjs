/**
 * The club directory parse (scripts/illinois/clubs/parse.mjs), checked on
 * small made-up pages shaped like the real one, then on data/clubs/ when a
 * crawl has filled it.
 *
 * Each case is a way the prototypes went wrong or a privacy rule:
 *   - a group that links its title to its own website kept a slug id and got
 *     a profile URL built from that website (78 invented links, such as
 *     https://one.illinois.edu/www.aim-illinois.com/);
 *   - tags were split on commas, so "Technology, Engineering & Mathematics"
 *     became two tags;
 *   - a download that ended early lost the alphabetical tail (16 groups)
 *     without an error;
 *   - the page shows student contact names, message links with uid= values
 *     and logos, and the feed carries event titles, descriptions and
 *     organizer addresses: none of that may be written;
 *   - a club listed a placeholder address as its website (Animal Liberation
 *     UIUC, https://example.com/), which shipped as its link;
 *   - the feed's second host answers 403 to robots.txt: the one exception to
 *     the house robots rule (crawl.mjs ROBOTS_EXCEPTION, owner-approved
 *     2026-10-05) must cover that host's /ical/urbanachampaign/ and nothing
 *     else.
 *
 *   node lib/planner/__clubs-parse.check.mjs        (a second or two)
 *
 * Exits non-zero on any FAIL.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const P = await import(join(ROOT, 'scripts', 'illinois', 'clubs', 'parse.mjs'));
// crawl.mjs runs only as a script; imported, it only lends its robots decision.
const CR = await import(join(ROOT, 'scripts', 'illinois', 'clubs', 'crawl.mjs'));
const RB = await import(join(ROOT, 'scripts', 'illinois', 'syllabi', 'lib', 'robots.mjs'));

let failures = 0;
const fail = (msg) => { failures += 1; console.log(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);
const expect = (cond, msg, detail = '') => (cond ? ok(msg) : fail(`${msg}${detail ? ` (${detail})` : ''}`));
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };

// ---------------------------------------------------------------------------
// a page shaped like https://one.illinois.edu/club_signup?view=all& on 2026-10-04

const PERSON = 'Jordan Q. Example';
const contact = (id) => `<div style="border-top:1px solid #ccc; margin-top:15px">
  <p style="margin-top:10px"> <span class='mdi mdi-comment-text-outline' style='color: #337ab7;'></span> Contact: <a title="Send a Message to ${PERSON}" href="javascript:;" onClick="openModal('/send_message_boot?club_id=${id}&uid=00000000-0000-4000-8000-000000000000&ax=1&async=1&modal=true');">${PERSON}</a></p>
</div>`;

function entry({ id, name, href, type = 'Orange Student Organization', tags = '', closed = false, restricted = '', mission = 'We meet weekly to build things together.', benefits = '', who = true }) {
  const box = closed
    ? `<button type="button" class="btn btn-link" onclick="alert('Membership is closed for ${name}.');" aria-label="${name}'s membership is closed"><span class="mdi" data-original-title="Membership Closed"></span></button><input type="hidden" class="nb" name="clubs" id="cb_club_${id}" />`
    : `<input id="cb_club_${id}" type="checkbox" class="nb" name="clubs" value="${id}" />`;
  return `<li class="list-group-item" style="padding: 20px 15px;">
<fieldset class="cg-acc--sr-fieldset"><legend><span class="sr-only">${name}</span></legend>
<div class="row" role="group" aria-label="${name}"><div class="col-md-1">${box}</div>
<div class="listing-element__title-block"><div class="media">
 <div class="media-left"><a target="_blank" href="
   ${href}
   "><img class="media-object" alt="${name} logo" src="/upload/urbanachampaign/2025/s2_image_upload_1_logo.png"></a></div>
 <div class="media-body">
  <h2 class="media-heading header-cg--h4"><a target="_blank" href="
   ${href}
   ">
   ${name}
  </a></h2>
  <p class="h5 media-heading grey-element">
   ${type}${tags ? `\n   - ${tags}` : ''}
  </p>
  <div style="word-break: break-word;">
   <p class="h5 media-heading" style="margin-top: 10px;">
    <a aria-label="Website" style="margin-right: 15px;" target="_blank" href="${href}"><span class="mdi mdi-web"></span>Website</a>
    ${who ? contact(id) : ''}
   </p>
   <p style="display:none" class="noOutlineOnFocus" tabindex="0" id="club_${id}"><strong>Mission</strong><br>${mission}<br /></p>
   <script>$("#club_${id}").on('focus', function() {});</script>
   <p style="display:none" class="noOutlineOnFocus" tabindex="0" id="club_whatwedo_${id}"><strong>Membership Benefits</strong><br>${benefits}</p>
  </div>
 </div>
</div></div>
<div>${restricted ? `<div id="email_restriction_${id}" style="display:none" class="alert alert-info"><span class="mdi mdi-information"></span> This group is restricted to ${restricted} users only </div>` : ''}</div>
</div>
<div class="desc-block col-md-3_5 text-left"><strong></strong><p><span style="color:#686868;">  Lifetime membership</span></p></div>
</div></fieldset>
</li>`;
}

const ENTRIES = [
  entry({ id: '35454', name: '4 Paws for Ability', href: 'https://uiuc4paws.com', tags: 'Advocacy &amp; Activism, Technology, Engineering &amp; Mathematics, Veterinary', restricted: 'Some University of Illinois Urbana-Champaign' }),
  entry({ id: '36407', name: 'Alpha Investment Management Partners', href: 'https://www.aim-illinois.com', type: 'Blue Student Organization', tags: 'Business' }),
  entry({ id: '36864', name: 'Green Streets', href: 'https://one.illinois.edu/greenstreets/home/', tags: 'Environmental &amp; Sustainability, ~ Affiliation: Grainger College of Engineering', mission: `Founded by ${PERSON}. Write to jdoe2&#64;illinois.edu or call (217) 555-0142.`, benefits: '- Field trips<br />- Friends' }),
  entry({ id: '36401', name: '4-H House Cooperative Sorority', href: 'https://one.illinois.edu/4HHouseCooperative/', type: 'Blue Student Organization', tags: 'Agricultural, Social Fraternities &amp; Sororities', closed: true, who: false }),
  entry({ id: '40001', name: 'Dotted Slug Club', href: 'https://one.illinois.edu/www.dotted-club.org/', tags: 'Humanities' }),
  entry({ id: '40002', name: 'Grainger Advising', href: 'https://grainger.illinois.edu/advising', type: 'Grainger Departments &amp; Programs', who: false }),
  entry({ id: '40003', name: 'Women&#39;s Undergraduate Law Society', href: 'https://one.illinois.edu/WomensUndergraduateLawSociety/', tags: 'Law', mission: '' }),
];
const option = (v, t) => `<option value="${v}">${t}</option>`;
const PAGE = `<!DOCTYPE html><html><head><title>Groups</title><script>var user = {id: 12345, csrf: 'x'};</script></head><body>
<small id="clubsCount"></small>
<select data-z="stype.05" id="select_category_tags" class="form-control" name="category_tags"><option value="">Group Category</option>
${option(1, 'Advocacy &amp; Activism')}${option(2, 'Agricultural')}${option(3, 'Business')}${option(4, 'Environmental &amp; Sustainability')}${option(5, 'Humanities')}${option(6, 'Law')}${option(7, 'Social Fraternities &amp; Sororities')}${option(8, 'Technology, Engineering &amp; Mathematics')}${option(9, 'Veterinary')}${option(10, '~ Affiliation: Grainger College of Engineering')}
</select>
<a href="club_signup?group_type=9999" class="btn">All <span class="badge badge-cg--money" id="allClubCount"></span></a>
<a class="btn" href="club_signup?group_type=86564&category_tags=">Orange Student Organization <span class="badge badge-cg--money">5</span></a>
<a class="btn" href="club_signup?group_type=86567&category_tags=">Blue Student Organization <span class="badge badge-cg--money">2</span></a>
<a class="btn" href="club_signup?group_type=86873&category_tags=">Grainger Departments & Programs <span class="badge badge-cg--money">1</span></a>
<script>
 document.getElementById('clubsCount').innerHTML = '(7)';
 const allClubCountEl = document.getElementById('allClubCount');
 if (!isEmpty(allClubCountEl)) { allClubCountEl.innerHTML = '7'; }
</script>
<form action="club_signup_form" method="post" name="form_clubs" id="form_clubs"><input type="hidden" name="_csrf" value="jkbb1BDY5fDPOdikKCgTSpiTVbGQ">
<ul class="list-group">
<li id="list-group-item_header" class="list-group-item hidden-sm hidden-xs"><strong>Join</strong></li>
${ENTRIES.join('\n')}
</ul></form></body></html>
`;

console.log('scrubDirectory: the page is cleaned in memory before anything is written');
const { html, report } = P.scrubDirectory(PAGE);
expect(!html.includes(PERSON), 'the contact name is gone everywhere, including the mission that repeats it', `${(html.match(new RegExp(PERSON.replace('.', '\\.'), 'g')) ?? []).length} left`);
expect(report.contactBlocks === 5 && report.names === 1 && report.namesBlanked === 1, 'five contact blocks dropped, one name learned, its one repeat blanked', JSON.stringify(report));
expect(!/uid=|send_message|Send a Message/i.test(html), 'no uid=, message link or "Send a Message" label survives');
expect(!/<img\b/i.test(html) && !html.includes('/upload/'), 'logos and /upload/ paths are dropped');
expect(!/jdoe2|@illinois/.test(P.decodeEntities(html)) && html.includes('[email]'), 'an entity-encoded email in a mission is blanked');
expect(!html.includes('555-0142') && html.includes('[phone]'), 'a phone number in a mission is blanked');
expect(html.includes("innerHTML = '(7)'") && !html.includes('var user'), "the count script is kept; every other script goes");
expect(/name="_csrf" value=""/.test(html), 'the form token is emptied');
expect(throws(() => P.scrubDirectory(PAGE.replace('</body>', `<!-- ${PERSON} --></body>`)), /contact name/), 'a contact name the scrubber cannot reach (an HTML comment) stops the run');
const plainContacts = Array.from({ length: 30 }, (_, i) => `<p>Contact: Person Number${i}</p>`).join('');
expect(throws(() => P.scrubDirectory(PAGE.replace('</body>', `${plainContacts}</body>`)), /Contact:" labels/), 'contacts shown without message links (a template change) stop the run');

console.log('\nparseDirectory: ids, links and tags');
const dir = P.parseDirectory(html);
const g = Object.fromEntries(dir.groups.map((x) => [x.id, x]));
expect(dir.groups.length === 7 && Object.keys(g).every((id) => /^\d+$/.test(id)), 'seven groups, each keyed by its numeric cb_club_ id', Object.keys(g).join(','));
expect(g['35454'].slug === null && g['35454'].website === 'https://uiuc4paws.com', 'a title linked off-site gives a website and no slug');
expect(g['36407'].slug === null && g['36407'].website === 'https://www.aim-illinois.com', 'AIM keeps its own site; no one.illinois.edu/www.aim-illinois.com/ is made');
expect(g['36864'].slug === 'greenstreets', '"/greenstreets/home/" on-host reads as the profile slug "greenstreets"');
expect(g['40001'].slug === null && dir.problems.some((p) => p.id === '40001'), 'an on-host link whose "slug" has a dot is not a profile, and is reported');
expect(JSON.stringify(g['35454'].categories) === JSON.stringify(['Advocacy & Activism', 'Technology, Engineering & Mathematics', 'Veterinary']), '"Technology, Engineering & Mathematics" stays one tag', JSON.stringify(g['35454'].categories));
expect(JSON.stringify(g['36864'].affiliations) === '["Grainger College of Engineering"]' && !g['36864'].categories.some((t) => t.includes('Affiliation')), 'affiliation tags are split out, prefix removed');
expect(g['36401'].membershipClosed && !g['35454'].membershipClosed, '"Membership Closed" is read');
expect(/restricted to Some University/.test(g['35454'].restriction ?? '') && g['36407'].restriction === null, 'the restriction notice is kept as a fact');
expect(g['40002'].office && !g['35454'].office && g['40002'].type === 'Grainger Departments & Programs', 'department accounts are marked as offices');
expect(g['40003'].name === "Women's Undergraduate Law Society" && g['40003'].mission === '', 'entities in names are decoded; an empty mission is empty');
expect(g['36864'].mission.includes('[name]') && g['36864'].benefits === '- Field trips\n- Friends', 'mission text keeps its line breaks and carries the blanks');

console.log('\nplaceholder links: a club never links to a reserved or test address');
for (const bad of ['https://example.com/', 'http://www.example.org/club', 'https://club.example.net', 'https://club.example', 'http://localhost:3000/', 'http://club.localhost/', 'https://club.test/x', 'https://x.invalid', 'http://127.0.0.1/', 'http://[::1]/']) {
  expect(P.offSite(bad) === null && P.placeholderLink(bad), `${bad} is a placeholder, never a website`);
}
for (const good of ['https://uiuc4paws.com', 'https://examples.com/', 'https://myexample.com', 'https://www.aim-illinois.com', 'http://sites.google.com/view/club']) {
  expect(P.offSite(good) === good && !P.placeholderLink(good), `${good} is a website`);
}
const PLACEHOLDER_PAGE = PAGE.replace('</ul></form>', `${entry({ id: '36823', name: 'Animal Liberation UIUC', href: 'https://example.com/', tags: 'Advocacy &amp; Activism', who: false })}\n</ul></form>`);
const ph = P.parseDirectory(P.scrubDirectory(PLACEHOLDER_PAGE).html);
const al = ph.groups.find((x) => x.id === '36823');
expect(al && al.website === null && al.slug === null && ph.problems.some((p) => p.id === '36823' && /placeholder/.test(p.problem)), 'Animal Liberation UIUC (36823) and its https://example.com/: no website, and the parse reports it', JSON.stringify(al && { website: al.website, slug: al.slug }));
const phAll = P.parseAll({ html: P.scrubDirectory(PLACEHOLDER_PAGE).html, htmlMeta: { fetchedAt: '2026-10-05T03:33:32Z' }, ics: null, icsMeta: null, previous: null });
const alOut = phAll.directory.groups.find((x) => x.id === '36823');
expect(alOut.url === null && !('website' in alOut) && phAll.directory.counts.links.placeholdersDropped === 1, 'with no profile, its url is null (build.mjs leaves it out), never example.com', JSON.stringify(alOut.url));
const phFeed = P.parseAll({ html: P.scrubDirectory(PLACEHOLDER_PAGE).html, htmlMeta: { fetchedAt: '2026-10-05T03:33:32Z' }, ics: P.scrubFeed(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'ORGANIZER;CN="Animal Liberation UIUC":mailto:noreply@one.illinois.edu', 'CONTACT:https://one.illinois.edu/AnimalLiberationUIUC/rsvp_boot?id=9', 'DTSTART:20261009T230000Z', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n')).ics, icsMeta: { url: 'u', fetchedAt: '2026-10-05T05:30:29Z' }, previous: null });
expect(phFeed.directory.groups.find((x) => x.id === '36823').url === 'https://one.illinois.edu/AnimalLiberationUIUC/', 'when the calendar names its profile, the profile is its link');
expect(phFeed.events.today === '2026-10-05' && phFeed.directory.checked === '2026-10-04', "events are judged from the day the calendar was read (Oct 5), the page keeps its own day (Oct 4 in Champaign)");

console.log('\nrobots.txt: the house rule, and its one exception (crawl.mjs ROBOTS_EXCEPTION)');
const FEED_HOP = 'https://static-prod-us-east-1.campusgroups.com/ical/urbanachampaign/ical_urbanachampaign.ics';
const denied = (status) => ({ verdict: 'deny-all', status, parsed: RB.DENY_ALL });
expect(CR.ROBOTS_EXCEPTION.host === 'static-prod-us-east-1.campusgroups.com' && CR.ROBOTS_EXCEPTION.pathPrefix === '/ical/urbanachampaign/' && CR.ROBOTS_EXCEPTION.approved === '2026-10-05', 'the exception names one host, one path and the day the owner approved it');
const hop = CR.robotsDecision(denied(403), FEED_HOP);
expect(hop.allowed && hop.exception && /RFC 9309/.test(hop.rule), 'the feed on the CampusGroups host, whose robots.txt answers 403: allowed, as "unavailable" (RFC 9309 2.3.1.3), and marked as the exception', hop.rule);
expect(CR.robotsDecision(denied(401), FEED_HOP).allowed, 'any 4xx robots.txt counts as unavailable there (401)');
/** @type {Array<{ why: string, robots: { verdict: string, status: number, parsed: object }, url: string }>} */
const HOUSE_RULE = [
  { why: 'another path on that host (logos)', robots: denied(403), url: 'https://static-prod-us-east-1.campusgroups.com/upload/urbanachampaign/logo.png' },
  { why: "another school's feed on that host", robots: denied(403), url: 'https://static-prod-us-east-1.campusgroups.com/ical/otherschool/ical_otherschool.ics' },
  { why: 'the feed path with a query', robots: denied(403), url: `${FEED_HOP}?x=1` },
  { why: 'another CampusGroups host', robots: denied(403), url: 'https://static-prod-us-west-2.campusgroups.com/ical/urbanachampaign/ical_urbanachampaign.ics' },
  { why: 'a 5xx robots.txt (unreachable: RFC 9309 says disallow)', robots: denied(503), url: FEED_HOP },
  { why: 'a 429 robots.txt (slow down)', robots: denied(429), url: FEED_HOP },
  { why: 'no answer at all', robots: denied(0), url: FEED_HOP },
  { why: 'plain http', robots: denied(403), url: FEED_HOP.replace('https:', 'http:') },
  { why: 'a robots.txt that answers 200 and disallows /ical/', robots: { verdict: 'rules', status: 200, parsed: RB.parseRobots('User-agent: *\nDisallow: /ical/') }, url: FEED_HOP },
];
for (const { why, robots, url } of HOUSE_RULE) {
  const d = CR.robotsDecision(robots, url);
  expect(!d.allowed && !d.exception, `the house rule still holds for ${why}: disallowed`, d.rule);
}
const oneIllinois = RB.parseRobots('User-agent: *\nDisallow: /upload/\nDisallow: /student_docs/\nDisallow: /downloads/\nDisallow: /mobile_ws/v17/\nDisallow: /mobile_ws/v18/\nDisallow: /*ajax_widget_new');
expect(CR.robotsDecision({ verdict: 'rules', status: 200, parsed: oneIllinois }, 'https://one.illinois.edu/ical/urbanachampaign/ical_urbanachampaign.ics').allowed && !CR.robotsDecision({ verdict: 'rules', status: 200, parsed: oneIllinois }, 'https://one.illinois.edu/upload/x.png').allowed, "one.illinois.edu's own robots.txt (2026-10-04) allows the feed's first hop and still refuses /upload/");

console.log('\ncountGuard: the parse must match the page');
const page = (n, complete = true) => ({ stated: [{ from: 'header', n }], complete });
const ALL = { 'Orange Student Organization': 1, 'Blue Student Organization': 1, 'Student Services & Support': 1, 'ACES Departments & Programs': 1, 'Grainger Departments & Programs': 1 };
expect(P.countGuard({ page: page(1197), parsed: 1197, byType: ALL, previous: 1197, checked: '2026-10-04' }).ok, '1197 of 1197 passes');
expect(!P.countGuard({ page: page(1197), parsed: 1181, byType: ALL, previous: null, checked: '2026-10-04' }).ok, '1181 of 1197 (the prototype) fails');
const near = P.countGuard({ page: page(1197), parsed: 1192, byType: ALL, previous: null, checked: '2026-10-04' });
expect(near.ok && near.warnings.length === 1, '5 short of 1197 (0.4%) passes with a warning');
expect(!P.countGuard({ page: page(1197, false), parsed: 1197, byType: ALL, previous: null, checked: '2026-10-04' }).ok, 'a page without </html> fails');
expect(!P.countGuard({ page: { stated: [], complete: true }, parsed: 1197, byType: ALL, previous: null, checked: '2026-10-04' }).ok, "a page that states no count fails");
expect(!P.countGuard({ page: page(1197), parsed: 1197, byType: { ...ALL, 'ACES Departments & Programs': 0 }, previous: null, checked: '2026-10-04' }).ok, 'a missing group type fails');
expect(!P.countGuard({ page: page(1000), parsed: 1000, byType: ALL, previous: 1197, checked: '2026-10-04' }).ok, 'a 16% drop from the last parse fails');
expect(P.countGuard({ page: page(1000), parsed: 1000, byType: ALL, previous: 1197, checked: '2026-10-04', acceptDrop: true }).ok, '... and passes with --accept-drop');
expect(P.countGuard({ page: page(650), parsed: 650, byType: ALL, previous: null, checked: '2026-07-01' }).ok && !P.countGuard({ page: page(650), parsed: 650, byType: ALL, previous: null, checked: '2026-10-04' }).ok, 'the floor is 600 from Jun 1 to Sep 15 and 900 otherwise');

console.log('\nscrubFeed and parseFeed: only names, slugs, start dates and event types');
const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:CAMPUSGROUPS', 'X-WR-CALNAME:University of Illinois Urbana-Champaign',
  'BEGIN:VEVENT', 'DTSTAMP:20261004T044252Z',
  'ORGANIZER;CN="Green Streets":mailto:noreply@one.illinois.edu',
  'CONTACT:https://one.illinois.edu/greenstreets/rsvp_boot?id=476443#event_host',
  'CATEGORIES;X-CG-CATEGORY=club_acronym:GREENSTREETS', 'CATEGORIES;X-CG-CATEGORY=event_type:Meeting', 'CATEGORIES;X-CG-CATEGORY=event_tags:Food,Fun',
  'DTSTART:20261009T030000Z', 'DTEND:20261009T040000Z', 'UID:41b2f34e@one.illinois.edu',
  'SUMMARY;ENCODING=QUOTED-PRINTABLE:Planting with jdoe2@illinois.edu', 'LOCATION: Sign in to download the location',
  'DESCRIPTION:Bring gloves. Questions? Call 217-555-0142 or write ', ' jdoe2@illinois.edu.', 'URL:https://one.illinois.edu/rsvp?id=476443',
  'BEGIN:VALARM', 'DESCRIPTION:reminder', 'END:VALARM', 'END:VEVENT',
  'BEGIN:VEVENT', 'ORGANIZER;CN="4 Paws for Ability":mailto:noreply@one.illinois.edu', 'CONTACT:https://one.illinois.edu/4PawsforAbility/rsvp_boot?id=1#event_host',
  'CATEGORIES;X-CG-CATEGORY=event_type:Social', 'DTSTART;TZID=America/Chicago:20260801T180000', 'SUMMARY:Puppy social', 'END:VEVENT',
  'BEGIN:VEVENT', 'ORGANIZER;CN="Women\'s Undergraduate Law Society":mailto:noreply@one.illinois.edu', 'CATEGORIES;X-CG-CATEGORY=event_type:Meeting', 'DTSTART;VALUE=DATE:20260301', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');
const feed = P.scrubFeed(ICS);
expect(!/SUMMARY|DESCRIPTION|LOCATION|UID|URL:|mailto|@|555|event_tags|club_acronym|VALARM/.test(feed.ics), 'titles, descriptions, places, uids, addresses and other tags are gone', feed.ics.replace(/\r\n/g, ' | '));
expect(feed.report.events === 3, 'three events kept');
const parsed = P.parseFeed(feed.ics);
expect(parsed.calendar === 'University of Illinois Urbana-Champaign' && parsed.events.length === 3, 'the calendar name and every event are read back');
const e0 = parsed.events[0];
expect(e0.name === 'Green Streets' && e0.slug === 'greenstreets' && e0.type === 'Meeting' && e0.date === '2026-10-08', 'a UTC start is dated in Champaign (03:00Z Oct 9 is Oct 8 there)', JSON.stringify(e0));
expect(parsed.events[1].date === '2026-08-01' && parsed.events[2].date === '2026-03-01' && parsed.events[2].slug == null, 'TZID and all-day starts are read; an event without CONTACT has no slug');

console.log('\njoinFeed: profiles from the feed, events onto groups');
const groups = P.parseDirectory(html).groups;
const join_ = P.joinFeed(groups, parsed.events, '2026-10-04');
const j = Object.fromEntries(groups.map((x) => [x.id, x]));
expect(j['35454'].slug === '4PawsforAbility' && j['35454'].slugFrom === 'feed', 'a group linked off-site gets its profile from the feed, by exact name');
expect(j['36407'].slug === null, 'a group the feed never names keeps no profile');
expect(join_.clubs['36864']?.next[0] === '2026-10-08' && join_.clubs['36864'].n120 === 0, 'an upcoming event is "next", not counted in the last 120 days');
expect(join_.clubs['35454']?.last === '2026-08-01' && join_.clubs['35454'].n120 === 1, 'an August event is the last one and counts in the last 120 days');
expect(join_.clubs['40003']?.last === '2026-03-01' && join_.clubs['40003'].n120 === 0 && join_.counts.byName === 1, 'a slugless event joins by name; March is outside the 120 days');
const taken = P.parseDirectory(html).groups;
const clash = P.joinFeed(taken, [{ name: '4 Paws for Ability', slug: 'greenstreets', date: '2026-09-01', type: null }], '2026-10-04');
expect(taken.find((x) => x.id === '35454').slug === null && clash.recovered.slugTaken === 1, "a feed slug that is already another group's profile is not borrowed");

// ---------------------------------------------------------------------------
// the real outputs, when a crawl has run

const DATA = join(ROOT, 'data', 'clubs');
if (!existsSync(join(DATA, 'directory.json'))) {
  console.log('\n(data/clubs/directory.json not found: run node scripts/illinois/clubs/crawl.mjs to check the real outputs too)');
} else {
  console.log('\ndata/clubs: the last crawl');
  const text = readFileSync(join(DATA, 'directory.json'), 'utf8');
  const d = JSON.parse(text);
  const c = d.counts;
  console.log(`  checked ${d.checked}; page ${c.onPage}, parsed ${c.parsed}, offices ${c.offices}, clubs ${c.clubs}; profile ${c.links.profileFromPage}+${c.links.profileFromFeed} (page+feed), website only ${c.links.websiteOnly}; feed ${d.calendar ? `read ${d.calendar.read}` : 'not read'}`);
  expect(c.parsed === c.onPage && c.parsed === d.groups.length, "the parse matches the page's own count");
  expect(c.onPage >= 900, 'at least 900 groups');
  expect(new Set(d.groups.map((x) => x.id)).size === d.groups.length && d.groups.every((x) => /^\d+$/.test(x.id)), 'ids are unique and numeric');
  const placeholderOnly = new Set(d.problems.filter((p) => /placeholder/.test(p.problem)).map((p) => p.id));
  const linkless = d.groups.filter((x) => !x.url);
  expect(linkless.every((x) => placeholderOnly.has(x.id)), "every group has a link, but for one whose only link was a placeholder (reported; build.mjs leaves it out)", linkless.filter((x) => !placeholderOnly.has(x.id)).map((x) => x.id).join(','));
  expect(d.groups.every((x) => !x.website || !P.placeholderLink(x.website)) && d.groups.find((x) => x.id === '36823')?.website !== 'https://example.com/', 'no group links a placeholder address (Animal Liberation UIUC lost https://example.com/)');
  if (linkless.length) console.log(`  info  no link at all: ${linkless.map((x) => `${x.id} ${x.name}`).join('; ')}`);
  const built = d.groups.filter((x) => x.url).filter((x) => {
    const u = new URL(x.url);
    return u.host === 'one.illinois.edu' ? !/^\/[A-Za-z0-9_-]+\/$/.test(u.pathname) || x.url !== x.profile : x.url !== x.website || x.profile;
  });
  expect(built.length === 0, 'no constructed link: on-host links are /<slug>/ profiles, any other link is the group\'s own website', built.slice(0, 3).map((x) => x.id).join(','));
  const vocab = new Set(d.vocabulary.topical);
  expect(d.groups.every((x) => x.categories.every((t) => vocab.has(t))), "every category is one of the page's tags");
  const PHONE = new RegExp(P.PHONE.source);
  for (const f of ['directory.json', 'events.json', 'texts.jsonl']) {
    if (!existsSync(join(DATA, f))) continue;
    const t = readFileSync(join(DATA, f), 'utf8');
    const bad = [new RegExp(P.EMAIL.source).test(t) && 'email', /[?&]uid=/i.test(t) && 'uid=', /send_message/i.test(t) && 'send_message', /Send a Message/i.test(t) && 'Send a Message', f !== 'texts.jsonl' && PHONE.test(t) && 'phone'].filter(Boolean);
    expect(bad.length === 0, `${f} holds no email, uid=, message link${f !== 'texts.jsonl' ? ' or phone number' : ''}`, bad.join(', '));
  }
  expect(!/"(mission|benefits)"/.test(text), 'directory.json holds no mission or benefits text');
  if (existsSync(join(DATA, 'texts.jsonl'))) {
    const rows = readFileSync(join(DATA, 'texts.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const byId = new Map(d.groups.map((x) => [x.id, x]));
    const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
    expect(rows.length === d.groups.length && rows.every((r) => byId.get(r.id)?.hash === r.hash && sha16(`${r.name}\n${r.mission}\n${r.benefits}`) === r.hash), 'texts.jsonl has one row per group and its hashes match directory.json');
  }
  if (existsSync(join(DATA, 'events.json'))) {
    const ev = JSON.parse(readFileSync(join(DATA, 'events.json'), 'utf8'));
    const ids = new Set(d.groups.map((x) => x.id));
    expect(Object.keys(ev.clubs).every((id) => ids.has(id)), 'events.json is keyed by directory ids only');
    expect(Object.values(ev.clubs).every((x) => x.events.every((e) => e.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(e[0]))), 'events.json holds dates and event types only');
    if (d.calendar) {
      expect(ev.today === d.calendar.read, `events are counted from the day the calendar was read (${ev.today})`);
      const fromFeed = d.groups.filter((x) => x.profileFrom === 'feed');
      expect(fromFeed.every((x) => /^https:\/\/one\.illinois\.edu\/[A-Za-z0-9_-]+\/$/.test(x.profile) && x.url === x.profile), `profiles recovered from the feed are /<slug>/ profiles and are the link (${fromFeed.length}; ${fromFeed.filter((x) => x.website).length} of them replace a website-only link)`);
      console.log(`  info  calendar read ${d.calendar.read} (Last-Modified ${d.calendar.lastModified}); ${d.calendar.events} events, ${d.calendar.firstDate} to ${d.calendar.lastDate}; clubs with an event in the last 120 days ${c.events.clubsN120}, with one coming up ${c.events.clubsUpcoming}`);
    }
  }
  const FEED_FILE = join(DATA, 'raw', 'ical_urbanachampaign.scrubbed.ics');
  if (existsSync(FEED_FILE)) {
    const ics = readFileSync(FEED_FILE, 'utf8');
    const kinds = new Set(ics.split(/\r\n|\n/).filter(Boolean).map((l) => l.replace(/[;:].*$/, '')));
    const allowed = new Set(['BEGIN', 'END', 'VERSION', 'PRODID', 'X-WR-CALNAME', 'X-WR-TIMEZONE', 'ORGANIZER', 'CONTACT', 'DTSTART', 'CATEGORIES']);
    expect([...kinds].every((k) => allowed.has(k)) && !/mailto:/i.test(ics) && !new RegExp(P.EMAIL.source).test(ics), 'the cached feed holds only group names, slugs, start times and event types', [...kinds].filter((k) => !allowed.has(k)).join(','));
  }
  const LOG = join(DATA, 'fetchlog.jsonl');
  if (existsSync(LOG)) {
    const rows = readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const sent = rows.filter((r) => !r.cached && new URL(r.url).host === CR.ROBOTS_EXCEPTION.host);
    const outside = sent.filter((r) => new URL(r.url).pathname !== '/robots.txt' && !new URL(r.url).pathname.startsWith(CR.ROBOTS_EXCEPTION.pathPrefix));
    const fetched = sent.filter((r) => r.status && new URL(r.url).pathname.startsWith(CR.ROBOTS_EXCEPTION.pathPrefix));
    expect(outside.length === 0 && fetched.every((r) => r.exception === true || r.robots === 'allow'), `the fetch log: on ${CR.ROBOTS_EXCEPTION.host} only robots.txt and ${CR.ROBOTS_EXCEPTION.pathPrefix} were ever requested (${fetched.length} feed request(s), each logged with its robots decision)`, outside.map((r) => r.url).join(', '));
  }
}

console.log(`\n${failures === 0 ? 'ALL CLUB PARSE CHECKS PASSED' : `${failures} CLUB PARSE CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
