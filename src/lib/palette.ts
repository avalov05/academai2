// ── Editorial pastel-tech palette ────────────────────────────────────────
// Class colours are mid-tone (not pale pastel) so blips stay legible on the
// off-white ground, but stay in the dusty pink → lavender → periwinkle family
// with a few separated hues so eight classes never read alike.
export const CLASS_COLORS = [
  '#E4566E', // rose
  '#4A72EE', // periwinkle
  '#8763DE', // violet
  '#1F9E96', // teal
  '#DE7BB0', // orchid
  '#E0894A', // apricot
  '#5B8C3E', // moss
  '#3C4A8C', // indigo
];

export function nextColor(used: string[]): string {
  for (const c of CLASS_COLORS) if (!used.includes(c)) return c;
  return CLASS_COLORS[used.length % CLASS_COLORS.length];
}

export const UI = {
  bg: '#F2F1ED',
  bgAlt: '#F6F5F2',
  charcoal: '#292929',
  text: '#292929',
  dim: '#555555',
  faint: 'rgba(41,41,41,0.38)',
  line: 'rgba(41,41,41,0.13)',
  lineStrong: 'rgba(41,41,41,0.26)',
  danger: '#E4566E',
  warn: '#E0894A',
  ok: '#1F9E96',
  accent: '#8763DE',
  // decorative pastels (pixel cloud, card feet)
  pink: '#FF949C',
  pinkSoft: '#F4C5CA',
  lavender: '#B9A8E6',
  periwinkle: '#9BA9F7',
  paleLavender: '#DDDDF6',
};

export const TYPE_GLYPH: Record<string, string> = {
  assignment: 'ASG', quiz: 'QZ', exam: 'EXM', project: 'PRJ', reading: 'RDG',
  study: 'STU', task: 'TSK', social: 'PPL', admin: 'ADM',
};
