'use client';
// ── Pixel field ───────────────────────────────────────────────────────────
// A quiet, always-there texture rather than an animation you notice.
//
// The geometry never changes — every cell is drawn at the same size, every
// frame. Only its *opacity* moves, and only in small quantised steps. That is
// what makes it smooth: nothing ever pops into or out of existence, nothing
// grows or shrinks, so there is no churn at the silhouette edge.
//
// A very slow field (60–110s periods) decides each cell's opacity level. A
// fixed per-cell dither offsets the level thresholds, so the boundaries
// between levels break up into stair-stepped pixel edges instead of marching
// across the screen as visible contour lines. Cells are drawn slightly
// oversized so neighbours touch and fuse into one soft-cornered mass.
//
// The cursor adds a wide, gently-falling boost to the same field, so it reads
// as light passing behind the page — smooth by construction, since it feeds
// the identical easing path as everything else.
import { useEffect, useRef } from 'react';

const CELL = 26;          // block pitch
const OVERLAP = 1.5;      // draw slightly large so neighbours fuse
const RADIUS = 6;
const LEVELS = 5;         // opacity steps
const MAX_ALPHA = 0.2;    // ceiling — this is a background
const BLOOM_R = 240;      // cursor influence radius
const EASE = 0.055;       // per-cell opacity easing (slow = silky)

interface Cell {
  x: number; y: number;
  nx: number; ny: number;   // normalised, precomputed
  dither: number;           // fixed threshold offset → stair-stepped edges
  clear: number;            // centre-clearing mask, precomputed
  a: number;                // current eased alpha
}

export default function Background() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d', { alpha: true })!;
    const hasRound = typeof (ctx as CanvasRenderingContext2D & { roundRect?: unknown }).roundRect === 'function';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let cells: Cell[] = [];
    let W = 0, H = 0;
    let grad: CanvasGradient | null = null;
    const ptr = { x: -9999, y: -9999, on: 0, active: false };

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // one gradient for the whole field, built once per resize
      grad = ctx.createLinearGradient(-W * 0.1, H * 0.9, W * 1.05, H * 0.05);
      grad.addColorStop(0, '#ff9a8b');
      grad.addColorStop(0.42, '#ff6a88');
      grad.addColorStop(0.76, '#c99bea');
      grad.addColorStop(1, '#a8b2ff');

      const cols = Math.ceil(W / CELL) + 2;
      const rows = Math.ceil(H / CELL) + 2;
      cells = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * CELL - CELL, y = r * CELL - CELL;
          const nx = x / W, ny = y / H;
          // deterministic per-cell dither, stable across frames
          const s = Math.sin(c * 127.1 + r * 311.7) * 43758.5453;
          // the content column runs the full height, so clear a *column*, not
          // an ellipse — otherwise texture creeps in above and below the cards
          const off = Math.abs(nx - 0.5);
          const clear = Math.min(1, Math.max(0, (off - 0.30) / 0.13));
          cells.push({ x, y, nx, ny, dither: (s - Math.floor(s)) - 0.5, clear, a: 0 });
        }
      }
    };

    let raf = 0;
    const t0 = performance.now();
    const levelAlpha: number[] = [];
    for (let i = 0; i <= LEVELS; i++) levelAlpha.push((i / LEVELS) * MAX_ALPHA);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const t = reduced ? 12 : (now - t0) / 1000;   // frozen field when motion is reduced
      ctx.clearRect(0, 0, W, H);
      if (!grad) return;

      if (!ptr.active && ptr.on > 0) ptr.on = Math.max(0, ptr.on - 0.02);

      // group cells by opacity level so the whole field is drawn in LEVELS fills
      const paths: Path2D[] = [];
      for (let i = 0; i < LEVELS; i++) paths.push(new Path2D());

      const size = CELL + OVERLAP * 2;

      for (const c of cells) {
        // very slow, large-wavelength field — one coherent drift, not lumps
        const v =
          0.50 +
          0.26 * Math.sin(c.nx * 2.2 + t * 0.055) +
          0.20 * Math.sin(c.ny * 3.0 - t * 0.038) +
          0.15 * Math.sin((c.nx + c.ny * 0.6) * 3.6 + t * 0.026);

        // diagonal band, then the centre clearing
        const band = 1 - Math.abs((c.ny - 0.5) + (c.nx - 0.5) * 0.28) * 1.35;
        let target = v * Math.max(0, band) * c.clear;

        // cursor: wide smooth boost feeding the same quantiser
        if (ptr.on > 0.005) {
          const d = Math.hypot(c.x + CELL / 2 - ptr.x, c.y + CELL / 2 - ptr.y);
          if (d < BLOOM_R) target += (1 - d / BLOOM_R) ** 2 * 0.5 * ptr.on;
        }

        // quantise with a fixed per-cell dither → stair-stepped pixel edges
        const lvl = Math.round(
          Math.max(0, Math.min(LEVELS, target * LEVELS + c.dither * 0.55)),
        );
        const want = levelAlpha[lvl];

        // ease opacity only — geometry is constant, so nothing can pop
        c.a += (want - c.a) * (reduced ? 0.5 : EASE);
        if (c.a < 0.006) continue;

        // bucket into the nearest draw level
        let bucket = Math.round((c.a / MAX_ALPHA) * LEVELS) - 1;
        if (bucket < 0) bucket = 0;
        if (bucket >= LEVELS) bucket = LEVELS - 1;
        const p = paths[bucket];
        if (hasRound) p.roundRect(c.x - OVERLAP, c.y - OVERLAP, size, size, RADIUS);
        else p.rect(c.x - OVERLAP, c.y - OVERLAP, size, size);
      }

      ctx.fillStyle = grad;
      for (let i = 0; i < LEVELS; i++) {
        ctx.globalAlpha = levelAlpha[i + 1];
        ctx.fill(paths[i]);
      }
      ctx.globalAlpha = 1;
    };

    const onMove = (e: PointerEvent) => {
      ptr.x = e.clientX; ptr.y = e.clientY;
      ptr.active = true;
      ptr.on = Math.min(1, ptr.on + 0.09);   // ramps in over ~0.2s, never snaps
    };
    const onLeave = () => { ptr.active = false; };
    const onResize = () => build();
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else raf = requestAnimationFrame(frame);
    };

    build();
    raf = requestAnimationFrame(frame);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return <canvas ref={ref} className="bg-canvas" aria-hidden />;
}
