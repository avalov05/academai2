// ── Editorial pastel-tech palette ────────────────────────────────────────
// Class colours are mid-tone (not pale pastel) so blips stay legible on the
// off-white ground, but stay in the dusty pink → lavender → periwinkle family
// with a few separated hues so eight classes never read alike.
export const CLASS_COLORS = [
  '#F0455F', // rose
  '#4F63E8', // periwinkle
  '#9B4FD8', // violet
  '#0E9E92', // teal
  '#E0559B', // orchid
  '#EE8022', // apricot
  '#4E9B2F', // moss
  '#2E3A96', // indigo
];

export function nextColor(used: string[]): string {
  for (const c of CLASS_COLORS) if (!used.includes(c)) return c;
  return CLASS_COLORS[used.length % CLASS_COLORS.length];
}

export const UI = {
  bgCanvas: '#EFEFEA',
  bgCard: '#FFFFFF',
  bgCardSubtle: '#F6F6F2',
  bgDark: '#1C1C1C',

  accentRose: '#FFD7D7',
  accentPeriwinkle: '#D2E0FF',
  accentLavender: '#E7DCFF',

  textPrimary: '#171717',
  textSecondary: '#6E6E6A',
  textMuted: '#9B9B95',
  textOnDark: '#FFFFFF',

  borderLight: '#E3E3DC',
  borderDark: '#2E2E2E',

  statusSuccess: '#D1E7DD',
  statusWarning: '#FFF3CD',
  statusDanger: '#F8D7DA',

  // gradient stops for the pixel mass
  gradA: '#FF9A8B',
  gradB: '#FF6A88',
  gradC: '#A8B2FF',
};

export const TYPE_GLYPH: Record<string, string> = {
  assignment: 'ASG', quiz: 'QZ', exam: 'EXM', project: 'PRJ', reading: 'RDG',
  study: 'STU', task: 'TSK', social: 'PPL', admin: 'ADM',
};
