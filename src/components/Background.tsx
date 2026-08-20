'use client';
// ── Pixel field ───────────────────────────────────────────────────────────
// A chunky cloud of rounded pastel blocks drifting across the off-white ground:
// coral → pink → lavender → periwinkle, sampled from a slow noise field so the
// silhouette has stair-step edges and punched-out holes. It breathes over ~30s.
// The cursor blooms nearby blocks — they brighten and swell, then settle back.
import { useEffect, useRef } from 'react';

const CELL = 32;        // grid pitch — chunky blocks
const GAP = 6;          // space between blocks
const RADIUS = 4;       // block corner radius
const BLOOM = 190;      // cursor influence radius

// coral → pink → lavender → periwinkle
const STOPS: Array<[number, number, number]> = [
  [255, 148, 156],
  [244, 197, 202],
  [185, 168, 230],
  [155, 169, 247],
];
function ramp(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(0.999, t)) * (STOPS.length - 1);
  const i = Math.floor(x), f = x - i;
  const a = STOPS[i], b = STOPS[Math.min(i + 1, STOPS.length - 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

interface Cell { cx: number; cy: number; u: number; bloom: number; }

export default function Background() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d', { alpha: true })!;
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
      cells = [];
      const cols = Math.ceil(W / CELL) + 1;
      const rows = Math.ceil(H / CELL) + 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // u = position along the diagonal band → drives the colour ramp
          cells.push({
            cx: c * CELL, cy: r * CELL,
            u: (c * CELL) / Math.max(W, 1) * 0.78 + (1 - (r * CELL) / Math.max(H, 1)) * 0.22,
            bloom: 0,
          });
        }
      }
    };

    // Slow layered-sine field: 1 inside the cloud, 0 outside. Stair-step edges
    // come free because we quantise to the grid.
    const field = (x: number, y: number, t: number) => {
      const nx = x / W, ny = y / H;
      const band =
        0.52 +
        0.20 * Math.sin(nx * 3.1 + t * 0.055) +
        0.15 * Math.sin(ny * 4.3 - t * 0.041) +
        0.13 * Math.sin((nx + ny) * 5.2 + t * 0.032) +
        0.09 * Math.sin((nx * 2.6 - ny * 3.4) + t * 0.07);
      // diagonal falloff so the cloud reads as one big drifting mass
      const diag = 1 - Math.abs((ny - 0.5) - (nx - 0.5) * 0.34) * 1.95;
      return band * Math.max(0, diag);
    };

    let raf = 0, last = 0;
    const t0 = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 40) return;   // 25fps — it barely moves anyway
      last = now;
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);

      if (!pointer.active && pointer.on > 0) pointer.on = Math.max(0, pointer.on - 0.03);

      for (const c of cells) {
        const v = field(c.cx, c.cy, t);
        if (v < 0.54) { c.bloom *= 0.9; continue; }   // outside the cloud → hole

        // cursor bloom
        let target = 0;
        if (pointer.on > 0.01) {
          const d = Math.hypot(c.cx - pointer.x, c.cy - pointer.y);
          if (d < BLOOM) target = (1 - d / BLOOM) ** 2 * pointer.on;
        }
        c.bloom += (target - c.bloom) * (reduced ? 1 : 0.12);

        const strength = Math.min(1, (v - 0.54) / 0.30);
        const [r, g, b] = ramp(c.u + Math.sin(t * 0.05 + c.cy * 0.004) * 0.05);
        // quiet by default; the cursor is what makes the cloud show itself
        const alpha = (0.05 + strength * 0.13) * (1 + c.bloom * 3.4);
        const grow = c.bloom * 4.5;
        const size = CELL - GAP + grow;
        const off = (CELL - size) / 2;

        ctx.fillStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${Math.min(0.62, alpha).toFixed(3)})`;
        const x = c.cx + off, y = c.cy + off, rad = RADIUS + grow * 0.4;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, size, size, rad);
        else ctx.rect(x, y, size, size);
        ctx.fill();
      }
    };

    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX; pointer.y = e.clientY;
      pointer.active = true;
      pointer.on = Math.min(1, pointer.on + 0.2);
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
