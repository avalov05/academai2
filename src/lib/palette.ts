// ── Warm editorial palette ───────────────────────────────────────────────
// Earthy, low-chroma hues that stay legible on cream and never read "neon".
export const CLASS_COLORS = [
  '#C2612F', // terracotta
  '#7A7A3C', // olive
  '#9C5A48', // clay
  '#B08529', // ochre
  '#6E6250', // umber grey
  '#A8563E', // burnt sienna
  '#87703A', // moss gold
  '#8C4A52', // dusty rose-brown
];

export function nextColor(used: string[]): string {
  for (const c of CLASS_COLORS) if (!used.includes(c)) return c;
  return CLASS_COLORS[used.length % CLASS_COLORS.length];
}

export const UI = {
  bg: '#F7F0E3',        // page ivory
  panelBg: '#E9D6AE',   // hero beige
  card: 'rgba(255,252,246,0.74)',
  line: 'rgba(60,45,25,0.14)',
  lineStrong: 'rgba(60,45,25,0.26)',
  text: '#1C1B19',
  dim: 'rgba(28,27,25,0.62)',
  faint: 'rgba(28,27,25,0.36)',
  danger: '#C0402A',    // deep vermilion, not neon
  warn: '#C98A1E',      // amber
  ok: '#5E7A46',        // moss green
  accent: '#D2712C',    // warm orange
  ink: '#171717',
};

export const TYPE_GLYPH: Record<string, string> = {
  assignment: 'ASG', quiz: 'QZ', exam: 'EXM', project: 'PRJ', reading: 'RDG',
  study: 'STU', task: 'TSK', social: 'PPL', admin: 'ADM',
};
