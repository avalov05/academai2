'use client';
// ── Pixel mass ────────────────────────────────────────────────────────────
// One connected blocky shape — no gaps between cells — filled with a single
// saturated gradient (coral → pink → violet → periwinkle). Cells are drawn as
// overlapping rounded rects so neighbours fuse into a continuous silhouette
// with soft outer corners and punched-out holes, like the reference graphic.
// It drifts and re-forms over ~40s, fringe blocks flicker in and out, and the
// cursor pushes a brighter bloom through the mass.
import { useEffect, useRef } from 'react';

const CELL = 34;      // block pitch
const R = 9;          // corner radius / neighbour overlap
const BLOOM = 210;

interface Cell { x: number; y: number; on: number; flick: number; }

export default function Background() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d', { alpha: true })!;
    const hasRound = typeof (ctx as CanvasRenderingContext2D & { roundRect?: unknown }).roundRect === 'function';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let cells: Cell[] = [];
    let W = 0, H = 0;
    const pointer = { x: -9999, y: -9999, on: 0, active: false };

    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.ceil(W / CELL) + 2;
      const rows = Math.ceil(H / CELL) + 2;
      cells = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const s = Math.sin(c * 91.7 + r * 47.3) * 43758.5453;
          cells.push({ x: c * CELL - CELL, y: r * CELL - CELL, on: 0, flick: s - Math.floor(s) });
        }
      }
    };

    // Field: > gate is inside the mass. Quantising to the grid gives the
    // stair-step edges; the sine layers make it breathe and re-form.
    const field = (x: number, y: number, t: number) => {
      const nx = x / Math.max(W, 1), ny = y / Math.max(H, 1);
      const body =
        0.50 +
        0.22 * Math.sin(nx * 2.9 + t * 0.048) +
        0.17 * Math.sin(ny * 4.1 - t * 0.037) +
        0.13 * Math.sin((nx + ny) * 5.0 + t * 0.029) +
        0.10 * Math.sin((nx * 2.4 - ny * 3.1) + t * 0.062);
      // the mass sweeps low-left → high-right like the reference
      const band = 1 - Math.abs((ny - 0.52) + (nx - 0.5) * 0.30) * 1.9;
      // …and is carved away through the middle so the content column stays
      // clean. The mass frames the UI instead of sitting under it.
      const dx = (nx - 0.5) * 1.0, dy = (ny - 0.5) * 1.45;
      const clear = Math.min(1, Math.max(0, (Math.hypot(dx, dy) - 0.30) / 0.14));
      return body * Math.max(0, band) * clear;
    };

    let raf = 0, last = 0;
    const t0 = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 45) return;
      last = now;
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);

      if (!pointer.active && pointer.on > 0) pointer.on = Math.max(0, pointer.on - 0.028);

      // build one path for the whole mass, then fill it once with the gradient
      const mass = new Path2D();
      const bloomPath = new Path2D();
      let anyBloom = false;

      for (const c of cells) {
        const v = field(c.x + CELL / 2, c.y + CELL / 2, t);
        // fringe cells flicker slowly — the scattered blocks at the edges
        const gate = 0.50 + (c.flick - 0.5) * 0.055 + Math.sin(t * 0.22 + c.flick * 31) * 0.018;
        const want = v > gate ? 1 : 0;
        c.on += (want - c.on) * (reduced ? 1 : 0.09);
        if (c.on < 0.35) continue;

        // grow by R so neighbours overlap and fuse into one silhouette
        const grow = R * c.on;
        if (hasRound) mass.roundRect(c.x - grow, c.y - grow, CELL + grow * 2, CELL + grow * 2, R * 1.9);
        else mass.rect(c.x - grow, c.y - grow, CELL + grow * 2, CELL + grow * 2);

        if (pointer.on > 0.01) {
          const d = Math.hypot(c.x + CELL / 2 - pointer.x, c.y + CELL / 2 - pointer.y);
          if (d < BLOOM) {
            const g2 = grow + (1 - d / BLOOM) ** 2 * 5 * pointer.on;
            anyBloom = true;
            if (hasRound) bloomPath.roundRect(c.x - g2, c.y - g2, CELL + g2 * 2, CELL + g2 * 2, R * 1.9);
            else bloomPath.rect(c.x - g2, c.y - g2, CELL + g2 * 2, CELL + g2 * 2);
          }
        }
      }

      // one saturated gradient across the whole mass, drifting slowly
      const shift = Math.sin(t * 0.03) * 0.06;
      const g = ctx.createLinearGradient(-W * 0.15, H * 0.85, W * 1.1, H * 0.1);
      g.addColorStop(Math.max(0, shift), '#FF9A8B');
      g.addColorStop(Math.min(0.5, Math.max(0.02, 0.40 + shift)), '#FF6A88');
      g.addColorStop(Math.min(0.97, 0.78 + shift), '#C99BEA');
      g.addColorStop(1, '#A8B2FF');

      ctx.globalAlpha = reduced ? 0.30 : 0.44;
      ctx.fillStyle = g;
      ctx.fill(mass);
      if (anyBloom) { ctx.globalAlpha = 0.34; ctx.fill(bloomPath); }
      ctx.globalAlpha = 1;
    };

    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX; pointer.y = e.clientY;
      pointer.active = true;
      pointer.on = Math.min(1, pointer.on + 0.22);
    };
    const onLeave = () => { pointer.active = false; };
    const onResize = () => build();
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else { last = 0; raf = requestAnimationFrame(frame); }
    };

    build();
    raf = requestAnimationFrame(frame);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <>
      <canvas ref={ref} className="bg-canvas" aria-hidden />
      <div className="bg-edges" aria-hidden />
    </>
  );
}
