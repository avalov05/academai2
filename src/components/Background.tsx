'use client';
// ── Filament field ────────────────────────────────────────────────────────
// A drift of thin warm sticks aligned to a very slow flow field. The cursor
// pushes through them like a hand through reeds — they swirl aside, darken
// slightly, then ease back. Nothing blinks, nothing bounces.
import { useEffect, useRef } from 'react';

interface Stick {
  x: number; y: number;        // rest position
  ox: number; oy: number;      // current positional offset (eased)
  len: number;
  angle: number;               // current angle (eased)
  alpha: number;               // current ink (eased)
  seed: number;
}

const SPACING = 44;      // px between filaments
const RADIUS = 190;      // cursor influence radius
const EASE_A = 0.09;     // angle easing
const EASE_P = 0.10;     // position easing
const EASE_I = 0.08;     // ink easing

export default function Background() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d', { alpha: true })!;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let sticks: Stick[] = [];
    let W = 0, H = 0, dpr = 1;
    const pointer = { x: -9999, y: -9999, strength: 0, active: false };

    const build = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      sticks = [];
      const cols = Math.ceil(W / SPACING) + 1;
      const rows = Math.ceil(H / SPACING) + 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // deterministic jitter so the grid never reads as a grid
          const s = Math.sin(c * 127.1 + r * 311.7) * 43758.5453;
          const j1 = s - Math.floor(s);
          const s2 = Math.sin(c * 269.5 + r * 183.3) * 43758.5453;
          const j2 = s2 - Math.floor(s2);
          sticks.push({
            x: c * SPACING + (j1 - 0.5) * SPACING * 0.85,
            y: r * SPACING + (j2 - 0.5) * SPACING * 0.85,
            ox: 0, oy: 0,
            len: 13 + j1 * 12,
            angle: 0, alpha: 0,
            seed: j2 * Math.PI * 2,
          });
        }
      }
    };

    // Smooth, cheap flow field from layered sines — evolves over ~minutes.
    const flowAngle = (x: number, y: number, t: number) =>
      Math.sin(x * 0.0052 + t * 0.13) * 1.15 +
      Math.cos(y * 0.0047 - t * 0.097) * 0.95 +
      Math.sin((x + y) * 0.0026 + t * 0.061) * 0.7;

    let raf = 0, last = 0;
    const t0 = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 22) return;          // ~45fps ceiling
      last = now;
      const t = (now - t0) / 1000;

      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = 'round';

      if (!pointer.active && pointer.strength > 0) {
        pointer.strength = Math.max(0, pointer.strength - 0.025);
      }

      for (const s of sticks) {
        let target = flowAngle(s.x, s.y, t) + s.seed * 0.12;
        let ink = 0.1;
        let px = 0, py = 0;

        if (pointer.strength > 0.01) {
          const dx = s.x - pointer.x, dy = s.y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < RADIUS) {
            const f = (1 - d / RADIUS) ** 2 * pointer.strength;
            // swirl tangentially around the cursor
            const tangential = Math.atan2(dy, dx) + Math.PI / 2;
            // shortest-path blend so filaments never spin the long way round
            let diff = tangential - target;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            target += diff * f;
            // and drift outward a touch
            const push = f * 16;
            px = (dx / (d || 1)) * push;
            py = (dy / (d || 1)) * push;
            ink = 0.1 + f * 0.3;
          }
        }

        // ease toward targets (this is what makes them settle back)
        let d2 = target - s.angle;
        while (d2 > Math.PI) d2 -= Math.PI * 2;
        while (d2 < -Math.PI) d2 += Math.PI * 2;
        s.angle += d2 * (reduced ? 1 : EASE_A);
        s.ox += (px - s.ox) * (reduced ? 1 : EASE_P);
        s.oy += (py - s.oy) * (reduced ? 1 : EASE_P);
        s.alpha += (ink - s.alpha) * (reduced ? 1 : EASE_I);

        const hx = (Math.cos(s.angle) * s.len) / 2;
        const hy = (Math.sin(s.angle) * s.len) / 2;
        const cx = s.x + s.ox, cy = s.y + s.oy;
        ctx.strokeStyle = `rgba(120, 94, 58, ${s.alpha.toFixed(3)})`;
        ctx.lineWidth = 1 + s.alpha * 1.6;
        ctx.beginPath();
        ctx.moveTo(cx - hx, cy - hy);
        ctx.lineTo(cx + hx, cy + hy);
        ctx.stroke();
      }
    };

    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX; pointer.y = e.clientY;
      pointer.active = true;
      pointer.strength = Math.min(1, pointer.strength + 0.16);
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
      <div className="bg-blobs" aria-hidden><i /><i /><i /></div>
      <canvas ref={ref} className="bg-canvas" aria-hidden />
      <div className="bg-noise" aria-hidden />
    </>
  );
}
