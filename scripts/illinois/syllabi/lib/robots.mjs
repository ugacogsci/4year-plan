/**
 * robots.txt, parsed the way RFC 9309 says and decided the strict way.
 *
 * The parse: groups start at one or more User-agent lines; the group for us is
 * every group naming "trubot" (case-insensitive), or failing that every "*"
 * group, merged. Rules match the URL path plus query; "*" matches any run of
 * characters and a trailing "$" anchors the end. The longest matching rule
 * wins and, at equal length, Allow beats Disallow. An empty "Disallow:" allows
 * everything.
 *
 * The decision around the parse lives in http.mjs and is stricter than the
 * RFC, because a scraper that guesses wrong here is the one thing this project
 * cannot take back: 404 or 410 means no rules; any other 4xx, any 5xx, a
 * network error or a redirect into a login means "disallow everything".
 *
 * Example, uofi.box.com on 2026-09-27:
 *   User-agent: *
 *   Disallow: /
 *   Allow: /s/
 *   Allow: /shared/
 * gives /s/1c1mp95... "allow" (rule "Allow: /s/", 3 characters, beats "/", 1)
 * and /index.php?rm=box_download_shared_file... "disallow" (rule "Disallow: /").
 */

/** Percent-decode what is safe to decode so "/a%7Eb" and "/a~b" compare equal, keeping "%2F" and friends encoded. */
function normalize(path) {
  return path.replace(/%([0-9A-Fa-f]{2})/g, (m, hex) => {
    const c = String.fromCharCode(parseInt(hex, 16));
    return /[A-Za-z0-9\-._~]/.test(c) ? c : `%${hex.toUpperCase()}`;
  });
}

function compile(pattern) {
  const anchored = pattern.endsWith('$');
  const body = normalize(anchored ? pattern.slice(0, -1) : pattern);
  const re = body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${re}${anchored ? '$' : ''}`);
}

/**
 * Parse robots.txt text into { agents: Map(name -> {rules, crawlDelay}), sitemaps }.
 * Unknown lines are ignored; a BOM and comments are stripped.
 */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  const sitemaps = [];
  for (const raw of String(text ?? '').replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === 'sitemap') { sitemaps.push(value); continue; }
    if (!current) continue; // rules before any User-agent line belong to nobody
    if (key === 'allow' || key === 'disallow') {
      if (key === 'disallow' && value === '') continue; // "Disallow:" with nothing = allow all
      current.rules.push({ allow: key === 'allow', pattern: value, re: compile(value), length: normalize(value).length });
    } else if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return { groups, sitemaps };
}

/** The merged rule group that applies to a product token, e.g. "trubot". */
export function groupFor(parsed, token = 'trubot') {
  // Equality on the product token, not substring: a group for "bot" is not a
  // group for "trubot", and reading it as one would apply someone else's rules.
  const mine = parsed.groups.filter((g) => g.agents.some((a) => a.replace(/\/.*$/, '').trim() === token));
  const chosen = mine.length ? mine : parsed.groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules);
  const delays = chosen.map((g) => g.crawlDelay).filter((d) => d != null);
  return { rules, crawlDelay: delays.length ? Math.max(...delays) : null, matched: mine.length ? 'trubot' : chosen.length ? '*' : 'none' };
}

/**
 * Decide one URL against a parsed file. Returns { allowed, rule }.
 * /robots.txt itself is always allowed, as the RFC says.
 */
export function decide(parsed, url, token = 'trubot') {
  const u = new URL(url);
  const path = normalize(`${u.pathname}${u.search}`);
  if (u.pathname === '/robots.txt') return { allowed: true, rule: 'robots.txt itself' };
  const { rules } = groupFor(parsed, token);
  let best = null;
  for (const r of rules) {
    if (!r.re.test(path)) continue;
    if (!best || r.length > best.length || (r.length === best.length && r.allow && !best.allow)) best = r;
  }
  if (!best) return { allowed: true, rule: 'no matching rule' };
  return { allowed: best.allow, rule: `${best.allow ? 'Allow' : 'Disallow'}: ${best.pattern}` };
}

/** Allow-all and deny-all stand-ins for the status-code cases. */
export const ALLOW_ALL = { groups: [], sitemaps: [] };
export const DENY_ALL = parseRobots('User-agent: *\nDisallow: /');
