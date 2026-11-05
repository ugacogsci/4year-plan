/**
 * UGA's own transfer equivalency list, one sending school per file.
 *
 *   node scripts/data/uga-transfer.mjs --fetch            (all schools below)
 *   node scripts/data/uga-transfer.mjs --fetch 005251 …   (some schools, by key)
 *
 * Source: UGA Admissions' public Transfer Equivalency Search,
 * https://apply.uga.edu/portal/transfer-equivalency . No login, and the
 * host's robots.txt allows every agent but two named crawlers (checked again
 * on each run, and the run stops if that changes). One request at a time, at
 * least 2 seconds apart, with the planner's own user agent. A run that meets
 * anything other than the plain results table (a challenge, a login) stops
 * and says so: nothing here is ever worked around.
 *
 * What is kept is facts only: the sending course code as the list prints it
 * (no space, "BIOL2107K") and the UGA result(s) for it: a UGA course
 * ("BIOL 1107"), a designation ("MATH 1GXX" core elective, "HIST 1GHX" core +
 * U.S. history, "ARTS 3TXX" elective) or "NTFR" for the list's "Not
 * Transferrable". UGA says the list is a guide, is not complete and can
 * change; the official evaluation comes after admission. So each file keeps
 * the date it was read, and the planner shows that date. Refresh once a term
 * (a data update: gate --mode data).
 *
 * The portal page carries a hidden reCAPTCHA badge, so lists are now read in
 * a real browser, one school per page view, at least 10 seconds apart, and
 * handed to this script:
 *
 *   node scripts/data/uga-transfer.mjs --from-browser <dir> [key …]
 *
 * <dir>/<key>.txt holds what the browser tab read from the results page,
 * parsed with the same rules as below (sending code, UGA result(s), row
 * count, the school name the page prints). Lines are "RESULT[+RESULT]|CODE
 * CODE …", where a code that starts with a digit keeps the letters of the
 * code before it ("ACC201 202" is ACC201 and ACC202; "!101" is the bare code
 * 101). The read date is the day the file was saved. If the page showed a
 * challenge, the file says so and the script stops.
 *
 *   node scripts/data/uga-transfer.mjs --words
 *
 * reads nothing: it only copies the match and not words below into
 * index.json for every school it lists. Every other run does the same
 * after its reads, so a word corrected here never waits for that school's
 * next read (those words decide which school's list a transcript opens).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'public', 'uga-transfer');
const UA = 'FourYearPlanBot/1.0 (student planning project; respects robots.txt)';
const BASE = 'https://apply.uga.edu';
const PORTAL = `${BASE}/portal/transfer-equivalency`;
const GAP_MS = 2000;

/**
 * The schools UGA students most often bring credit from: the University
 * System of Georgia, the Technical College System of Georgia, and common
 * private and out-of-state feeders. `key` is the portal's own school key.
 * `match` is the lower-case words that identify the school on a transcript.
 */
export const SCHOOLS = [
  // University System of Georgia (USG)
  // "Georgia Tech" is also the end of several technical colleges' names as
  // transcripts and the portal print them ("Wiregrass Georgia Tech College",
  // "Middle Georgia Tech"), and the longer match word would win over theirs.
  { key: '005248', name: 'Georgia Institute of Technology', system: 'usg', match: ['georgia institute of technology', 'georgia tech'], not: ['technical college', 'tech college', 'technical institute', 'wiregrass', 'middle georgia', 'heart of georgia', 'central georgia', 'north georgia', 'south georgia', 'west georgia', 'east georgia', 'coastal georgia'] },
  { key: '005251', name: 'Georgia State University', system: 'usg', match: ['georgia state university', 'georgia state'], not: ['middle georgia', 'east georgia', 'south georgia'] },
  { key: '005359', name: 'Kennesaw State University', system: 'usg', match: ['kennesaw state'] },
  { key: '005253', name: 'Georgia Southern University', system: 'usg', match: ['georgia southern'] },
  // Augusta State University kept this school code when it became Augusta
  // University (2013), so UGA's list under it is the same school's list.
  { key: '005336', name: 'Augusta University', system: 'usg', match: ['augusta university', 'augusta state university'] },
  { key: '005855', name: 'Valdosta State University', system: 'usg', match: ['valdosta state'] },
  { key: '005900', name: 'University of West Georgia', system: 'usg', match: ['university of west georgia'] },
  // "East Georgia College", "North Georgia College", "Middle Georgia College"
  // and "South Georgia College" are other System schools' former names.
  { key: '005252', name: 'Georgia College & State University', system: 'usg', match: ['georgia college & state', 'georgia college and state', 'georgia college'], not: ['east georgia', 'north georgia', 'middle georgia', 'south georgia'] },
  { key: '005497', name: 'University of North Georgia', system: 'usg', match: ['university of north georgia', 'north georgia college'] },
  // Columbus State Community College is in Ohio.
  { key: '005123', name: 'Columbus State University', system: 'usg', match: ['columbus state'], not: ['community college'] },
  { key: '005145', name: 'Clayton State University', system: 'usg', match: ['clayton state'] },
  { key: '005250', name: 'Georgia Southwestern State University', system: 'usg', match: ['georgia southwestern'] },
  { key: '005220', name: 'Fort Valley State University', system: 'usg', match: ['fort valley state'] },
  { key: '005004', name: 'Albany State University', system: 'usg', match: ['albany state'] },
  { key: '005609', name: 'Savannah State University', system: 'usg', match: ['savannah state'] },
  { key: '005439', name: 'Middle Georgia State University', system: 'usg', match: ['middle georgia state university', 'middle georgia state', 'middle georgia college', 'macon state college'] },
  { key: '004796', name: 'Georgia Gwinnett College', system: 'usg', match: ['georgia gwinnett'] },
  { key: '005167', name: 'Dalton State College', system: 'usg', match: ['dalton state'] },
  { key: '005001', name: 'Abraham Baldwin Agricultural College', system: 'usg', match: ['abraham baldwin'] },
  { key: '005078', name: 'College of Coastal Georgia', system: 'usg', match: ['coastal georgia'] },
  { key: '005200', name: 'East Georgia State College', system: 'usg', match: ['east georgia state', 'east georgia college'] },
  { key: '005237', name: 'Georgia Highlands College', system: 'usg', match: ['georgia highlands'] },
  { key: '005256', name: 'Gordon State College', system: 'usg', match: ['gordon state'] },
  { key: '005619', name: 'South Georgia State College', system: 'usg', match: ['south georgia state', 'south georgia college'] },
  { key: '005725', name: 'Atlanta Metropolitan State College', system: 'usg', match: ['atlanta metropolitan'] },
  // Technical College System of Georgia (TCSG): UGA takes general-education courses only.
  { key: '000462', name: 'Athens Technical College', system: 'tcsg', match: ['athens technical', 'athens tech'] },
  { key: '003921', name: 'Albany Technical College', system: 'tcsg', match: ['albany technical', 'albany tech'] },
  { key: '005030', name: 'Atlanta Technical College', system: 'tcsg', match: ['atlanta technical', 'atlanta tech'] },
  { key: '002620', name: 'Augusta Technical College', system: 'tcsg', match: ['augusta technical', 'augusta tech'] },
  { key: '001709', name: 'Central Georgia Technical College', system: 'tcsg', match: ['central georgia technical', 'central georgia tech'] },
  { key: '005441', name: 'Chattahoochee Technical College', system: 'tcsg', match: ['chattahoochee technical', 'chattahoochee tech'] },
  { key: '004172', name: 'Coastal Pines Technical College', system: 'tcsg', match: ['coastal pines'] },
  // "Columbus Technical Institute" was this college's name until 2000 (the
  // portal still prints it) and Ohio's Columbus State Community College's
  // until 1987, both in a city named Columbus: a name that shows Ohio opens
  // no list.
  { key: '005704', name: 'Columbus Technical College', system: 'tcsg', match: ['columbus technical', 'columbus tech'], not: [', oh', 'ohio'] },
  { key: '002860', name: 'Georgia Northwestern Technical College', system: 'tcsg', match: ['georgia northwestern'] },
  { key: '003226', name: 'Georgia Piedmont Technical College', system: 'tcsg', match: ['georgia piedmont'] },
  { key: '005168', name: 'Gwinnett Technical College', system: 'tcsg', match: ['gwinnett technical', 'gwinnett tech'] },
  { key: '130352', name: 'Lanier Technical College', system: 'tcsg', match: ['lanier technical', 'lanier tech'] },
  { key: '005507', name: 'North Georgia Technical College', system: 'tcsg', match: ['north georgia technical', 'north georgia tech'] },
  { key: '005772', name: 'Oconee Fall Line Technical College', system: 'tcsg', match: ['oconee fall line'] },
  { key: '000154', name: 'Ogeechee Technical College', system: 'tcsg', match: ['ogeechee'] },
  { key: '003741', name: 'Savannah Technical College', system: 'tcsg', match: ['savannah technical', 'savannah tech'] },
  { key: '006555', name: 'South Georgia Technical College', system: 'tcsg', match: ['south georgia technical', 'south georgia tech'] },
  { key: '005652', name: 'Southeastern Technical College', system: 'tcsg', match: ['southeastern technical'] },
  { key: '005670', name: 'Southern Crescent Technical College', system: 'tcsg', match: ['southern crescent'] },
  { key: '007058', name: 'Southern Regional Technical College', system: 'tcsg', match: ['southern regional technical', 'southwest georgia technical', 'southwest georgia tech', 'moultrie technical'] },
  // "Southwest Georgia Technical College" is Southern Regional's former name.
  { key: '006342', name: 'West Georgia Technical College', system: 'tcsg', match: ['west georgia technical', 'west georgia tech'], not: ['southwest georgia'] },
  { key: '004557', name: 'Wiregrass Georgia Technical College', system: 'tcsg', match: ['wiregrass georgia technical', 'wiregrass'] },
  // Private and out-of-state schools UGA students often come from.
  { key: '005111', name: 'Clemson University', system: 'other', match: ['clemson'] },
  { key: '005187', name: 'Emory University', system: 'other', match: ['emory university'], not: ['oxford'] },
  { key: '005186', name: 'Oxford College of Emory University', system: 'other', match: ['oxford college'] },
  { key: '005409', name: 'Mercer University', system: 'other', match: ['mercer university'] },
  { key: '005059', name: 'Berry College', system: 'other', match: ['berry college'] },
  { key: '005521', name: 'Oglethorpe University', system: 'other', match: ['oglethorpe'] },
  { key: '001005', name: 'Auburn University', system: 'other', match: ['auburn university'] },
  { key: '001830', name: 'The University of Alabama', system: 'other', match: ['university of alabama'], not: ['birmingham', 'huntsville'] },
  { key: '005818', name: 'University of South Carolina', system: 'other', match: ['university of south carolina'], not: ['aiken', 'upstate', 'beaufort'] },
  { key: '001843', name: 'University of Tennessee', system: 'other', match: ['university of tennessee'], not: ['chattanooga', 'martin'] },
  { key: '005812', name: 'University of Florida', system: 'other', match: ['university of florida'] },
  { key: '005219', name: 'Florida State University', system: 'other', match: ['florida state university'] },
  { key: '005113', name: 'College of Charleston', system: 'other', match: ['college of charleston'] },
  { key: '005816', name: 'University of North Carolina at Chapel Hill', system: 'other', match: ['chapel hill', 'unc chapel hill'] },
  // Added 2026-10-14 (read in the browser): common feeders the first pass did not hold.
  { key: '001058', name: 'Belmont University', system: 'other', match: ['belmont university'] },
  { key: '005249', name: 'Georgia Military College', system: 'other', match: ['georgia military college', 'georgia military'] },
  { key: '001871', name: 'Vanderbilt University', system: 'other', match: ['vanderbilt'] },
  { key: '005537', name: 'Piedmont University', system: 'other', match: ['piedmont university', 'piedmont college'] },
  { key: '005184', name: 'Emmanuel University', system: 'other', match: ['emmanuel university', 'emmanuel college'], not: ['boston', 'massachusetts'] },
  { key: '005990', name: 'Young Harris College', system: 'other', match: ['young harris'] },
  { key: '005002', name: 'Agnes Scott College', system: 'other', match: ['agnes scott'] },
  { key: '005628', name: 'Spelman College', system: 'other', match: ['spelman'] },
  { key: '005415', name: 'Morehouse College', system: 'other', match: ['morehouse college'], not: ['school of medicine'] },
  { key: '005631', name: 'Savannah College of Art and Design', system: 'other', match: ['savannah college of art'] },
  { key: '005066', name: 'Brenau University', system: 'other', match: ['brenau'] },
  { key: '005568', name: 'Reinhardt University', system: 'other', match: ['reinhardt'] },
  { key: '005798', name: 'Truett McConnell University', system: 'other', match: ['truett mcconnell', 'truett-mcconnell'] },
  { key: '005362', name: 'LaGrange College', system: 'other', match: ['lagrange college', 'la grange college'] },
  { key: '005616', name: 'Shorter University', system: 'other', match: ['shorter university', 'shorter college'] },
  { key: '005895', name: 'Wesleyan College', system: 'other', match: ['wesleyan college'], not: ['kentucky wesleyan', 'north carolina wesleyan', 'virginia wesleyan', 'iowa wesleyan', 'tennessee wesleyan', 'west virginia wesleyan'] },
  { key: '006124', name: 'Covenant College', system: 'other', match: ['covenant college'] },
  { key: '001302', name: 'Samford University', system: 'other', match: ['samford'] },
  { key: '001856', name: 'University of Alabama at Birmingham', system: 'other', match: ['university of alabama at birmingham', 'university of alabama birmingham'] },
  { key: '001738', name: 'Troy University', system: 'other', match: ['troy university'] },
  { key: '001831', name: 'University of Tennessee at Chattanooga', system: 'other', match: ['university of tennessee at chattanooga', 'university of tennessee chattanooga', 'ut chattanooga'] },
  { key: '005222', name: 'Furman University', system: 'other', match: ['furman'] },
  { key: '005837', name: 'Coastal Carolina University', system: 'other', match: ['coastal carolina university'] },
  { key: '005233', name: 'University of Central Florida', system: 'other', match: ['university of central florida'] },
  { key: '005828', name: 'University of South Florida', system: 'other', match: ['university of south florida'] },
  { key: '001840', name: 'University of Mississippi', system: 'other', match: ['university of mississippi', 'ole miss'] },
  { key: '006373', name: 'Louisiana State University', system: 'other', match: ['louisiana state university'], not: ['shreveport', 'alexandria', 'eunice', 'health'] },
  { key: '001837', name: 'University of Kentucky', system: 'other', match: ['university of kentucky'] },
  { key: '005859', name: 'Virginia Tech', system: 'other', match: ['virginia tech', 'virginia polytechnic'] },
  // Added 2026-11-04 (read in the browser from UGA's Transfer Equivalency Search): the University of
  // Illinois, community and technical colleges in the states around Georgia, and common out-of-state
  // and online universities. Spartanburg Community College and Western Governors University have no
  // UGA list.
  { key: '001836', name: 'University of Illinois Urbana-Champaign', system: 'other', match: ['university of illinois urbana', 'university of illinois at urbana', 'urbana-champaign', 'uiuc'], not: ['chicago', 'springfield'] },
  { key: '005869', name: 'Valencia College', system: 'other', match: ['valencia college', 'valencia community college'] },
  { key: '005457', name: 'Miami Dade College', system: 'other', match: ['miami dade college', 'miami-dade college', 'miami dade community college'] },
  { key: '005653', name: 'Santa Fe College', system: 'other', match: ['santa fe college', 'santa fe community college'], not: ['new mexico', 'nm'] },
  // Renamed Tallahassee State College in 2025; the same college and list.
  { key: '005794', name: 'Tallahassee Community College', system: 'other', match: ['tallahassee community college', 'tallahassee state college'] },
  { key: '005232', name: 'Florida State College at Jacksonville', system: 'other', match: ['florida state college at jacksonville', 'florida state college jacksonville'] },
  { key: '005074', name: 'Broward College', system: 'other', match: ['broward college', 'broward community college'] },
  { key: '004177', name: 'Hillsborough Community College', system: 'other', match: ['hillsborough community college'] },
  { key: '005531', name: 'Palm Beach State College', system: 'other', match: ['palm beach state college', 'palm beach community college'] },
  { key: '005073', name: 'Eastern Florida State College', system: 'other', match: ['eastern florida state college', 'brevard community college'] },
  { key: '005535', name: 'Pensacola State College', system: 'other', match: ['pensacola state college', 'pensacola junior college'] },
  { key: '005106', name: 'Chipola College', system: 'other', match: ['chipola college', 'chipola junior college'] },
  { key: '005606', name: 'St. Petersburg College', system: 'other', match: ['st. petersburg college', 'st petersburg college', 'saint petersburg college'] },
  { key: '005221', name: 'Florida Gulf Coast University', system: 'other', match: ['florida gulf coast university'] },
  { key: '005049', name: 'Trident Technical College', system: 'other', match: ['trident technical college'] },
  { key: '005278', name: 'Greenville Technical College', system: 'other', match: ['greenville technical college', 'greenville tech'] },
  { key: '005584', name: 'Midlands Technical College', system: 'other', match: ['midlands technical college'] },
  { key: '005789', name: 'Tri-County Technical College', system: 'other', match: ['tri-county technical college', 'tri county technical college'] },
  { key: '005989', name: 'York Technical College', system: 'other', match: ['york technical college'] },
  { key: '005102', name: 'Central Piedmont Community College', system: 'other', match: ['central piedmont community college', 'central piedmont'] },
  { key: '001084', name: 'Chattanooga State Community College', system: 'other', match: ['chattanooga state'] },
  { key: '000319', name: 'Pellissippi State Community College', system: 'other', match: ['pellissippi state'] },
  { key: '000850', name: 'Nashville State Community College', system: 'other', match: ['nashville state community college', 'nashville state'] },
  { key: '002848', name: 'Cleveland State Community College', system: 'other', match: ['cleveland state community college'], not: ['cleveland state university', 'ohio'] },
  { key: '001352', name: 'Jefferson State Community College', system: 'other', match: ['jefferson state community college'] },
  { key: '000528', name: 'Wallace State Community College', system: 'other', match: ['wallace state community college', 'wallace state'], not: ['selma'] },
  { key: '001728', name: 'Southern Union State Community College', system: 'other', match: ['southern union state community college', 'southern union'] },
  { key: '001356', name: 'Calhoun Community College', system: 'other', match: ['calhoun community college'] },
  { key: '005229', name: 'Florida Atlantic University', system: 'other', match: ['florida atlantic university'] },
  { key: '005206', name: 'Florida International University', system: 'other', match: ['florida international university'] },
  { key: '005815', name: 'University of Miami', system: 'other', match: ['university of miami'], not: ['ohio', 'miami university'] },
  { key: '005010', name: 'Appalachian State University', system: 'other', match: ['appalachian state university'] },
  { key: '005180', name: 'East Carolina University', system: 'other', match: ['east carolina university'] },
  { key: '005156', name: 'Duke University', system: 'other', match: ['duke university'] },
  { key: '005820', name: 'University of Virginia', system: 'other', match: ['university of virginia'], not: ['wise', 'college at wise'] },
  { key: '005570', name: 'Virginia Commonwealth University', system: 'other', match: ['virginia commonwealth university'] },
  { key: '001592', name: 'The Ohio State University', system: 'other', match: ['ohio state university'] },
  { key: '002660', name: 'Pennsylvania State University', system: 'other', match: ['pennsylvania state university', 'penn state'] },
  { key: '001839', name: 'University of Michigan', system: 'other', match: ['university of michigan'], not: ['dearborn', 'flint'] },
  { key: '001324', name: 'Indiana University Bloomington', system: 'other', match: ['indiana university bloomington', 'indiana university'], not: ['purdue', 'indianapolis', 'southeast', 'northwest', 'kokomo', 'east', 'south bend'] },
  { key: '001631', name: 'Purdue University', system: 'other', match: ['purdue university'], not: ['global', 'fort wayne', 'northwest'] },
  { key: '006003', name: 'Texas A&M University', system: 'other', match: ['texas a&m university', 'texas a & m university'], not: ['qatar', 'commerce', 'corpus', 'kingsville', 'west texas', 'international', 'san antonio', 'texarkana', 'central texas'] },
  { key: '001480', name: 'Mississippi State University', system: 'other', match: ['mississippi state university'] },
  { key: '006866', name: 'University of Arkansas', system: 'other', match: ['university of arkansas'], not: ['little rock', 'pine bluff', 'monticello', 'fort smith', 'medical'] },
  { key: '006875', name: 'University of Missouri', system: 'other', match: ['university of missouri'], not: ['kansas city', 'st. louis', 'st louis', 'science and technology'] },
  { key: '003649', name: 'Southern New Hampshire University', system: 'other', match: ['southern new hampshire university', 'snhu'] },
  { key: '004007', name: 'Arizona State University', system: 'other', match: ['arizona state university'] },
  { key: '005385', name: 'Liberty University', system: 'other', match: ['liberty university'] },
  { key: '005496', name: 'North Carolina State University', system: 'other', match: ['north carolina state', 'nc state'] },
  // Added 2026-11-05 (read in the browser from UGA's Transfer Equivalency Search): Georgia private
  // colleges and community and technical colleges in North Carolina, South Carolina, Florida, Alabama,
  // Tennessee and Virginia, so more schools in each common-numbering system have UGA's own answers.
  // Davidson-Davie, Western Piedmont, Brunswick, Williamsburg Tech, Denmark Tech, Chattahoochee Valley,
  // Bevill State, Wallace Selma, Trenholm State and Dyersburg State have no UGA list.
  { key: '005110', name: 'Clark Atlanta University', system: 'other', match: ['clark atlanta university'] },
  { key: '007006', name: 'Life University', system: 'other', match: ['life university'] },
  { key: '005799', name: 'Toccoa Falls College', system: 'other', match: ['toccoa falls college'] },
  { key: '005009', name: 'Andrew College', system: 'other', match: ['andrew college'], not: ['st. andrew', 'saint andrew', 'st andrew'] },
  { key: '005068', name: 'Brewton-Parker College', system: 'other', match: ['brewton-parker', 'brewton parker'] },
  { key: '005072', name: 'Thomas University', system: 'other', match: ['thomas university'], not: ['jefferson', 'st. thomas', 'st thomas', 'saint thomas'] },
  { key: '005029', name: 'Point University', system: 'other', match: ['point university'], not: ['high point', 'west point'] },
  { key: '005530', name: 'Paine College', system: 'other', match: ['paine college'] },
  { key: '005928', name: 'Wake Technical Community College', system: 'other', match: ['wake technical community college', 'wake tech community college'] },
  { key: '005275', name: 'Guilford Technical Community College', system: 'other', match: ['guilford technical community college'] },
  { key: '005208', name: 'Fayetteville Technical Community College', system: 'other', match: ['fayetteville technical community college'] },
  { key: '005172', name: 'Durham Technical Community College', system: 'other', match: ['durham technical community college'] },
  { key: '005234', name: 'Forsyth Technical Community College', system: 'other', match: ['forsyth technical community college'] },
  { key: '005094', name: 'Cape Fear Community College', system: 'other', match: ['cape fear community college'] },
  { key: '005033', name: 'Asheville-Buncombe Technical Community College', system: 'other', match: ['asheville-buncombe technical', 'asheville buncombe technical'] },
  { key: '005262', name: 'Gaston College', system: 'other', match: ['gaston college'], not: ['kipp'] },
  { key: '005589', name: 'Rowan-Cabarrus Community College', system: 'other', match: ['rowan-cabarrus community college', 'rowan cabarrus community college'] },
  { key: '005644', name: 'Blue Ridge Community College', system: 'other', match: ['blue ridge community college'], not: ['virginia', 'weyers cave'] },
  { key: '005667', name: 'Southwestern Community College', system: 'other', match: ['southwestern community college'], not: ['iowa', 'creston', 'chula vista', 'michigan', 'southwestern michigan', 'southwestern illinois', 'southwestern oregon'] },
  { key: '005785', name: 'Tri-County Community College', system: 'other', match: ['tri-county community college', 'tri county community college'] },
  { key: '005790', name: 'Alamance Community College', system: 'other', match: ['alamance community college'] },
  { key: '005134', name: 'Coastal Carolina Community College', system: 'other', match: ['coastal carolina community college'] },
  { key: '005148', name: 'Craven Community College', system: 'other', match: ['craven community college'] },
  { key: '000727', name: 'Johnston Community College', system: 'other', match: ['johnston community college'] },
  { key: '005098', name: 'Catawba Valley Community College', system: 'other', match: ['catawba valley community college'] },
  { key: '005146', name: 'Caldwell Community College and Technical Institute', system: 'other', match: ['caldwell community college'] },
  { key: '005289', name: 'Haywood Community College', system: 'other', match: ['haywood community college'] },
  { key: '005319', name: 'Isothermal Community College', system: 'other', match: ['isothermal community college'] },
  { key: '005649', name: 'Sandhills Community College', system: 'other', match: ['sandhills community college'] },
  { key: '005921', name: 'Wilkes Community College', system: 'other', match: ['wilkes community college'] },
  { key: '005656', name: 'Surry Community College', system: 'other', match: ['surry community college'] },
  { key: '005037', name: 'Aiken Technical College', system: 'other', match: ['aiken technical college'] },
  { key: '005550', name: 'Piedmont Technical College', system: 'other', match: ['piedmont technical college'], not: ['georgia piedmont'] },
  { key: '005668', name: 'Spartanburg Community College', system: 'other', match: ['spartanburg community college', 'spartanburg technical college'] },
  { key: '005305', name: 'Horry-Georgetown Technical College', system: 'other', match: ['horry-georgetown technical college', 'horry georgetown technical college'] },
  { key: '005047', name: 'Technical College of the Lowcountry', system: 'other', match: ['technical college of the lowcountry', 'technical college of the low country'] },
  { key: '005207', name: 'Florence-Darlington Technical College', system: 'other', match: ['florence-darlington technical college', 'florence darlington technical college'] },
  { key: '005527', name: 'Orangeburg-Calhoun Technical College', system: 'other', match: ['orangeburg-calhoun technical college', 'orangeburg calhoun technical college'] },
  { key: '005095', name: 'Northeastern Technical College', system: 'other', match: ['northeastern technical college'] },
  { key: '005662', name: 'Seminole State College of Florida', system: 'other', match: ['seminole state college of florida', 'seminole community college'] },
  { key: '005159', name: 'Daytona State College', system: 'other', match: ['daytona state college'] },
  { key: '005548', name: 'Polk State College', system: 'other', match: ['polk state college'] },
  { key: '005322', name: 'Indian River State College', system: 'other', match: ['indian river state college'] },
  { key: '005191', name: 'Florida SouthWestern State College', system: 'other', match: ['florida southwestern state college', 'edison state college'] },
  { key: '005127', name: 'College of Central Florida', system: 'other', match: ['college of central florida', 'central florida community college'] },
  { key: '005641', name: 'St. Johns River State College', system: 'other', match: ['st. johns river state college', 'st johns river state college', 'saint johns river state college'] },
  { key: '005271', name: 'Gulf Coast State College', system: 'other', match: ['gulf coast state college', 'gulf coast community college'], not: ['mississippi'] },
  { key: '005490', name: 'University of North Florida', system: 'other', match: ['university of north florida'] },
  { key: '005503', name: 'North Florida College', system: 'other', match: ['north florida college', 'north florida community college'], not: ['university of north florida'] },
  { key: '001262', name: 'Gadsden State Community College', system: 'other', match: ['gadsden state community college'] },
  { key: '001721', name: 'Snead State Community College', system: 'other', match: ['snead state community college'] },
  { key: '001576', name: 'Northeast Alabama Community College', system: 'other', match: ['northeast alabama community college'] },
  { key: '001939', name: 'Coastal Alabama Community College', system: 'other', match: ['coastal alabama community college', 'faulkner state community college'] },
  { key: '003338', name: 'Shelton State Community College', system: 'other', match: ['shelton state community college'] },
  { key: '001213', name: 'Enterprise State Community College', system: 'other', match: ['enterprise state community college'] },
  { key: '001264', name: 'Wallace Community College', system: 'other', match: ['wallace community college dothan', 'george c. wallace community college', 'george c wallace community college', 'wallace community college'], not: ['selma', 'lurleen', 'corley', 'wallace state', 'sparks'] },
  { key: '001517', name: 'Bishop State Community College', system: 'other', match: ['bishop state community college'] },
  { key: '001933', name: 'Lawson State Community College', system: 'other', match: ['lawson state community college'] },
  { key: '001429', name: 'Lurleen B. Wallace Community College', system: 'other', match: ['lurleen b. wallace', 'lurleen b wallace', 'lurleen burns wallace'] },
  { key: '000188', name: 'Northwest-Shoals Community College', system: 'other', match: ['northwest-shoals community college', 'northwest shoals community college'] },
  { key: '002108', name: 'J. F. Drake State Community and Technical College', system: 'other', match: ['drake state community', 'drake state technical'] },
  { key: '001881', name: 'Volunteer State Community College', system: 'other', match: ['volunteer state community college'] },
  { key: '001543', name: 'Motlow State Community College', system: 'other', match: ['motlow state community college'] },
  { key: '001081', name: 'Columbia State Community College', system: 'other', match: ['columbia state community college'] },
  { key: '001656', name: 'Roane State Community College', system: 'other', match: ['roane state community college'] },
  { key: '001893', name: 'Walters State Community College', system: 'other', match: ['walters state community college'] },
  { key: '000453', name: 'Northeast State Community College', system: 'other', match: ['northeast state community college'] },
  { key: '002266', name: 'Jackson State Community College', system: 'other', match: ['jackson state community college'] },
  { key: '005515', name: 'Northern Virginia Community College', system: 'other', match: ['northern virginia community college'] },
  { key: '005032', name: 'Tidewater Community College', system: 'other', match: ['tidewater community college'] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function get(url) {
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return text;
}

const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();

/** "MATH 1GXX", "BIOL 1107L", "NTFR" as the planner reads them. */
function ugaResult(cell) {
  const s = strip(cell).toUpperCase();
  if (/NOT\s+TRANSFER/.test(s) || /^NTFR\b/.test(s)) return 'NTFR';
  const m = s.match(/^([A-Z]{2,5})\s*(\d[0-9A-Z]{3}[A-Z]{0,2})$/);
  return m ? `${m[1]} ${m[2]}` : s;
}

async function robotsAllow() {
  const text = await get(`${BASE}/robots.txt`);
  // Our agent falls under "*"; stop if "*" ever disallows the portal path.
  const blocks = text.split(/\n(?=User-agent:)/i);
  for (const block of blocks) {
    if (!/User-agent:\s*\*/i.test(block)) continue;
    for (const line of block.split('\n')) {
      const m = line.match(/^Disallow:\s*(\S*)/i);
      if (m && m[1] && ('/portal/transfer-equivalency'.startsWith(m[1]) || m[1] === '/')) return false;
    }
  }
  return true;
}

async function findKey(school) {
  const q = school.name.replace(/^The /, '').replace(/ & /g, ' ');
  const json = JSON.parse(await get(`${BASE}/manage/service/lookup?type=school&q=${encodeURIComponent(q)}`));
  const items = (json.item ?? []).map((i) => ({ ...i, name: strip(i.name) }));
  const want = school.name.toLowerCase().replace(/^the /, '');
  const hit = items.find((i) => i.name.toLowerCase().replace(/^the /, '') === want) ?? items.find((i) => i.name.toLowerCase().startsWith(want));
  if (!hit) {
    console.log(`  no exact match for ${school.name}: ${items.slice(0, 6).map((i) => `${i.name} [${i.key}] ${i.region ?? ''}`).join(' | ')}`);
    return null;
  }
  return hit.key;
}

/** A date as YYYY-MM-DD in local time (the day the list was read here). */
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** What a browser tab handed over for one school (see the note at the top). */
function readBrowserList(path) {
  const head = {};
  const courses = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('#')) {
      const i = line.indexOf('=');
      head[line.slice(1, i)] = line.slice(i + 1);
      continue;
    }
    const bar = line.indexOf('|');
    const results = line.slice(0, bar).split('+');
    let prev = '';
    for (const tok of line.slice(bar + 1).split(' ').filter(Boolean)) {
      const from = tok.startsWith('!') ? tok.slice(1) : /^\d/.test(tok) && prev ? prev + tok : tok;
      prev = from.match(/^[^0-9]*/)[0];
      if (courses[from]) throw new Error(`${path}: ${from} listed twice`);
      courses[from] = results;
    }
  }
  if (head.challenge !== 'false') return { challenge: true };
  if (head.bad !== '0') throw new Error(`${path}: the page had codes this format cannot carry`);
  const rows = Object.fromEntries(Object.keys(courses).sort().map((k) => [k, courses[k]]));
  if (Object.keys(rows).length !== Number(head.courses)) throw new Error(`${path}: ${Object.keys(rows).length} courses, page had ${head.courses}`);
  return { challenge: false, listed: head.listed && head.listed !== 'null' ? head.listed : null, n: Number(head.n), rows, readAt: localDay(statSync(path).mtime) };
}

async function main() {
  const args = process.argv.slice(2);
  const fb = args.indexOf('--from-browser');
  const browserDir = fb >= 0 ? args[fb + 1] : null;
  const wordsOnly = args.includes('--words');
  const picked = args.filter((a, i) => a !== '--fetch' && a !== '--words' && (fb < 0 || (i !== fb && i !== fb + 1)));
  const only = picked.length > 0 ? new Set(picked) : null;
  if (!browserDir && !args.includes('--fetch') && !wordsOnly) {
    // Reading the portal directly needs the owner's say-so (its page carries
    // a reCAPTCHA badge); the default way is the browser hand-off above.
    console.error('Nothing read: pass --from-browser <dir> (the usual way) or --fetch (direct, only with the owner\'s say-so).');
    process.exit(1);
  }
  if (!browserDir && !wordsOnly && !(await robotsAllow())) {
    console.error('robots.txt no longer allows the portal for our agent: stopping.');
    process.exit(2);
  }
  mkdirSync(OUT, { recursive: true });
  const indexPath = join(OUT, 'index.json');
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { schools: [] };
  for (const school of wordsOnly ? [] : SCHOOLS) {
    if (only && !only.has(school.key) && !only.has(school.name)) continue;
    let key, listed, rows, n, readAt;
    if (browserDir) {
      key = school.key;
      const path = join(browserDir, `${key}.txt`);
      if (!existsSync(path)) continue;
      const read = readBrowserList(path);
      if (read.challenge) {
        console.error(`The browser met a challenge for ${school.name}: stopping, nothing worked around.`);
        process.exit(3);
      }
      ({ listed, rows, n, readAt } = read);
    } else {
      key = school.key ?? (await findKey(school));
      if (!key) continue;
      const html = await get(`${PORTAL}?cmd=search&ceeb=${key}`);
      if (/g-recaptcha-response|captcha challenge|verify you are human/i.test(html) && !/<th>Transferring Course<\/th>/.test(html)) {
        console.error(`A challenge page came back for ${school.name}: stopping, nothing worked around.`);
        process.exit(3);
      }
      listed = html.match(/Here are the results for <b>([^<]+)<\/b>/)?.[1] ?? null;
      rows = {};
      n = 0;
      for (const m of html.matchAll(/<tr[^>]*>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/g)) {
        const from = strip(m[1]).toUpperCase().replace(/\s+/g, '');
        const to = ugaResult(m[2]);
        if (!from || !to) continue;
        (rows[from] ??= []).includes(to) || rows[from].push(to);
        n += 1;
      }
      readAt = localDay(new Date());
    }
    const url = `${PORTAL}?cmd=search&ceeb=${key}`;
    const file = { school: school.name, listedAs: listed, key, system: school.system, source: url, portal: PORTAL, readAt, rows: n, courses: rows };
    writeFileSync(join(OUT, `${key}.json`), JSON.stringify(file) + '\n');
    const entry = { key, name: school.name, system: school.system, match: school.match, ...(school.not ? { not: school.not } : {}), readAt, rows: n, courses: Object.keys(rows).length };
    index.schools = [...index.schools.filter((s) => s.key !== key), entry];
    console.log(`${school.name} [${key}] ${listed ?? '?'}: ${n} rows, ${Object.keys(rows).length} courses`);
  }
  // Every entry takes this file's match and not words, read today or not:
  // they decide which school's list a transcript opens, and an index that
  // kept a list's words from the day it was read opened Georgia Tech's list
  // for "Wiregrass Georgia Tech College" and Columbus State University's for
  // Ohio's Columbus State Community College after the words here were fixed.
  const words = new Map(SCHOOLS.filter((s) => s.key).map((s) => [s.key, s]));
  index.schools = index.schools.map((e) => {
    const s = words.get(e.key);
    if (!s) return e;
    const { key, name, system, match: _m, not: _n, readAt, rows, courses, ...rest } = e;
    return { key, name, system, match: s.match, ...(s.not ? { not: s.not } : {}), readAt, rows, courses, ...rest };
  });
  index.source = PORTAL;
  index.note = "UGA Admissions' Transfer Equivalency Search. UGA calls it a guide that is not complete and can change; the official evaluation comes after admission.";
  index.legend = { number: 'a UGA course', GXX: 'general-education core elective', GHX: 'core elective that also meets the U.S. history requirement', TXX: 'transfer elective credit only', NTFR: 'does not transfer' };
  index.schools.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(indexPath, JSON.stringify(index, null, 1) + '\n');
}

// Only when run as a script: lib/planner/__transfer.check.mjs imports SCHOOLS
// to see that index.json carries these match and not words.
if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
