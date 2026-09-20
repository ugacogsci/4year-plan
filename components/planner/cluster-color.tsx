/**
 * One colour per department, stable across loads.
 *
 * The demo catalog had six clusters and a hand-picked palette. Illinois has 194
 * subject prefixes, so any hand-picked set leaves most of the catalog uncoloured
 * or, worse, silently filtered out. A hue derived from the subject's own letters
 * means CS is the same blue on every load and every department gets one.
 */
const NAMED: Record<string, string> = {
  Foundations: '#e6bd54',
  Computation: '#62b9ea',
  'Mind & Brain': '#ef7294',
  Language: '#a68af5',
  Philosophy: '#f28b57',
  'University Core': '#8b98a8',
};

export function clusterColor(cluster: string): string {
  const known = NAMED[cluster];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < cluster.length; i++) {
    hash = (hash * 31 + cluster.charCodeAt(i)) % 360;
  }
  return `hsl(${hash} 62% 62%)`;
}
