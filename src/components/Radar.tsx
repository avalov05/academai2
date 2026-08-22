'use client';
// ── APPROACH RADAR: every obligation is an inbound object ─────────────────
//
// Reading order, deliberately: the sweep sits *behind* the grid so it never
// washes out the rings; class identity lives on the rim as a coloured arc and
// a solid name plate; blips sit on top; labels are placed by search, never by
// pushing — a label that cannot find clear space is simply not drawn, so no
// leader line ever crosses the scope.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppContext';
import type { Item } from '@/lib/types';
import { itemImpact } from '@/lib/types';
import { isActive } from '@/lib/planner';
import { humanDelta, fmtEt } from '@/lib/time';
import { sfx } from '@/lib/sound';
import { TYPE_GLYPH } from '@/lib/palette';

const LIFE = '#7C7C76';
const INK = '#171717';
const OVERDUE = '#E0555F';
const PAPER = '#EFEFEA';
const SWEEP = '155,169,247';        // periwinkle, rgb triplet
const TRAIL = 1.05;                 // radians of tail behind the sweep line

/** perceived lightness 0..1 — light blips need a darker outline to hold up */
function lightness(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** white or ink, whichever survives on this background */
function onColor(hex: string): string {
  return lightness(hex) > 0.63 ? '#1a1a18' : '#ffffff';
}

// hours-until-due → radius fraction (piecewise)
const ANCHORS: Array<[number, number]> = [
  [0, 0.13], [24, 0.34], [72, 0.52], [168, 0.70], [336, 0.85], [504, 0.965],
];
function rFrac(hours: number): number {
  if (hours <= 0) return 0.05;
  for (let i = 1; i < ANCHORS.length; i++) {
    const [h0, r0] = ANCHORS[i - 1], [h1, r1] = ANCHORS[i];
    if (hours <= h1) return r0 + (r1 - r0) * ((hours - h0) / (h1 - h0));
  }
  return 0.965;
}
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

interface Blip {
  it: Item; x: number; y: number; size: number;
  color: string; overdue: boolean; angle: number; r: number; isTest: boolean;
}
interface Box { x0: number; y0: number; x1: number; y1: number }
const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const c = ctx as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void };
  ctx.beginPath();
  if (typeof c.roundRect === 'function') c.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

// where a label may sit relative to its blip, best first
const CAND: Array<[number, number]> = [
  [1, 0], [-1, 0], [0.92, -0.62], [0.92, 0.62], [-0.92, -0.62], [-0.92, 0.62],
  [0.34, -1], [0.34, 1], [-0.34, -1], [-0.34, 1],
];
const MAX_LABELS = 14;

export default function Radar() {
  const { data, now, openDetail } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const blipsRef = useRef<Blip[]>([]);
  const [tip, setTip] = useState<{ x: number; y: number; it: Item } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  const lastPing = useRef(0);
  const sweepRef = useRef(0);

  const active = useMemo(() =>
    data.items.filter(i => isActive(i) || (i.ghost && i.status === 'pending')).filter(i => i.due_at),
  [data.items]);

  const classById = useMemo(() => new Map(data.classes.map(c => [c.id, c])), [data.classes]);

  // sectors: one per class + LIFE
  const sectors = useMemo(() => {
    const ids = [...data.classes.map(c => c.id), 'LIFE'];
    const w = (Math.PI * 2) / ids.length;
    const map = new Map<string, { a0: number; a1: number; label: string; color: string }>();
    ids.forEach((id, i) => {
      const a0 = -Math.PI / 2 + i * w;
      const k = classById.get(id);
      map.set(id, { a0, a1: a0 + w, label: k ? k.code : 'LIFE', color: k ? k.color : LIFE });
    });
    return map;
  }, [data.classes, classById]);

  useEffect(() => { hoverRef.current = hover; }, [hover]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.round(rect.width * dpr)) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = rect.width, H = rect.height;
      const cx = W / 2, cy = H / 2;
      // room reserved outside the rim for the class name plates
      const R = Math.min(W, H) / 2 - 56;
      ctx.clearRect(0, 0, W, H);
      const taken: Box[] = [];

      // ── 1. sweep, drawn first so the grid stays crisp on top of it ──
      if (!reduced) sweepRef.current = (t / 6400) % (Math.PI * 2);
      const sw = sweepRef.current - Math.PI / 2;
      if (ctx.createConicGradient) {
        // the bright edge lands exactly on the line: the tail is the only
        // thing behind it, so line and glow read as one object
        const g = ctx.createConicGradient(sw - TRAIL, cx, cy);
        const edge = TRAIL / (Math.PI * 2);
        g.addColorStop(0, `rgba(${SWEEP},0)`);
        g.addColorStop(edge * 0.45, `rgba(${SWEEP},0.04)`);
        g.addColorStop(edge * 0.82, `rgba(${SWEEP},0.11)`);
        g.addColorStop(edge, `rgba(${SWEEP},0.21)`);
        g.addColorStop(Math.min(1, edge + 0.0012), `rgba(${SWEEP},0)`);
        g.addColorStop(1, `rgba(${SWEEP},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.985, 0, Math.PI * 2);
        ctx.fill();
        // fade the wedge out towards the middle so the centre stays readable
        ctx.globalCompositeOperation = 'destination-out';
        const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        rg.addColorStop(0, 'rgba(0,0,0,1)');
        rg.addColorStop(0.26, 'rgba(0,0,0,0.55)');
        rg.addColorStop(0.62, 'rgba(0,0,0,0.10)');
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
      }
      // the line itself, matched to the wedge it leads
      const lg = ctx.createLinearGradient(cx, cy, cx + Math.cos(sw) * R, cy + Math.sin(sw) * R);
      lg.addColorStop(0, `rgba(${SWEEP},0)`);
      lg.addColorStop(0.28, `rgba(${SWEEP},0.34)`);
      lg.addColorStop(0.85, `rgba(${SWEEP},0.6)`);
      lg.addColorStop(1, `rgba(${SWEEP},0.18)`);
      ctx.strokeStyle = lg;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sw) * R * 0.985, cy + Math.sin(sw) * R * 0.985);
      ctx.stroke();
      // head
      ctx.fillStyle = `rgba(${SWEEP},0.75)`;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(sw) * R * 0.985, cy + Math.sin(sw) * R * 0.985, 2.6, 0, Math.PI * 2);
      ctx.fill();

      // ── 2. rings ──
      const rings: Array<[number, string]> = [[0.13, 'NOW'], [0.34, '24H'], [0.52, '3D'], [0.70, '1W'], [0.85, '2W'], [0.965, '3W+']];
      ctx.lineWidth = 1.2;
      for (const [f, label] of rings) {
        ctx.beginPath();
        ctx.strokeStyle = f === 0.13 ? 'rgba(224,85,95,0.62)' : (f === 0.965 ? 'rgba(23,23,23,0.40)' : 'rgba(23,23,23,0.20)');
        ctx.setLineDash(f === 0.965 ? [] : [3, 5]);
        ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '700 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3.4; ctx.lineJoin = 'round';
        ctx.strokeStyle = PAPER;
        ctx.strokeText(label, cx, cy - R * f - 5);
        ctx.fillStyle = '#8b8b83';
        ctx.fillText(label, cx, cy - R * f - 5);
        ctx.lineWidth = 1.2;
        taken.push({ x0: cx - 20, y0: cy - R * f - 15, x1: cx + 20, y1: cy - R * f + 1 });
      }
      // sector separators
      for (const [, s] of sectors) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(23,23,23,0.14)';
        ctx.lineWidth = 1;
        ctx.moveTo(cx + Math.cos(s.a0) * R * 0.13, cy + Math.sin(s.a0) * R * 0.13);
        ctx.lineTo(cx + Math.cos(s.a0) * R, cy + Math.sin(s.a0) * R);
        ctx.stroke();
      }
      // crosshair
      ctx.strokeStyle = 'rgba(23,23,23,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 7, cy); ctx.lineTo(cx + 7, cy);
      ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy + 7);
      ctx.stroke();
      taken.push({ x0: cx - 30, y0: cy - 16, x1: cx + 30, y1: cy + 30 });
      // the overdue counter is painted last but its space is claimed now, so a
      // label can never land on top of the one number that must stay readable
      const overCount = active.filter(i => !i.ghost && new Date(i.due_at!).getTime() <= now.getTime()).length;
      if (overCount) taken.push({ x0: cx - 62, y0: cy + R * 0.13 + 3, x1: cx + 62, y1: cy + R * 0.13 + 20 });

      // ── 3. blips ──
      const blips: Blip[] = [];
      for (const it of active) {
        const hours = (new Date(it.due_at!).getTime() - now.getTime()) / 3600000;
        const overdue = hours <= 0 && !it.ghost;
        const secId = it.class_id && sectors.has(it.class_id) ? it.class_id : 'LIFE';
        const s = sectors.get(secId)!;
        const pad = (s.a1 - s.a0) * 0.14;
        const angle = s.a0 + pad + hash01(it.id) * (s.a1 - s.a0 - pad * 2);
        const jit = overdue ? (Math.sin(t / 60 + hash01(it.id) * 99) * 2.5) : 0;
        const r = R * (overdue ? 0.05 + hash01(it.id) * 0.04 : rFrac(hours));
        const x = cx + Math.cos(angle) * r + jit;
        const y = cy + Math.sin(angle) * r + (overdue ? Math.cos(t / 47) * 2 : 0);
        // a "test" is anything you sit for: an exam, or an in-class quiz
        const isTest = it.type === 'exam' || (it.type === 'quiz' && it.at_home === false);
        const size = (5 + itemImpact(it) * 9.5) * (isTest ? 1.5 : 1);
        const color = overdue ? OVERDUE : (classById.get(it.class_id ?? '')?.color ?? LIFE);
        blips.push({ it, x, y, size, color, overdue, angle, r, isTest });

        // short inbound trail — a tick of heading, not a line across the scope
        if (!overdue) {
          ctx.beginPath();
          ctx.strokeStyle = color + '99';
          ctx.lineWidth = 1;
          ctx.setLineDash(it.ghost ? [2, 4] : []);
          const tr = Math.min(r + 9 + itemImpact(it) * 7, R * 0.99);
          ctx.moveTo(cx + Math.cos(angle) * tr, cy + Math.sin(angle) * tr);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // shape by type
        ctx.save();
        ctx.translate(x, y);
        const pulse = 1 + (overdue ? 0.22 * Math.sin(t / 130) : 0.05 * Math.sin(t / 460 + hash01(it.id) * 20));
        ctx.scale(pulse, pulse);
        ctx.beginPath();
        if (it.type === 'exam') { ctx.moveTo(0, -size); ctx.lineTo(size, 0); ctx.lineTo(0, size); ctx.lineTo(-size, 0); ctx.closePath(); }
        else if (it.type === 'project') { ctx.rect(-size * 0.8, -size * 0.8, size * 1.6, size * 1.6); }
        else if (it.type === 'quiz') { ctx.moveTo(0, -size); ctx.lineTo(size * 0.95, size * 0.75); ctx.lineTo(-size * 0.95, size * 0.75); ctx.closePath(); }
        else { ctx.arc(0, 0, size * 0.85, 0, Math.PI * 2); }
        if (it.ghost) {
          ctx.strokeStyle = color + 'CC'; ctx.lineWidth = 1.8; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
        } else {
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke();
          const lum = lightness(color);
          ctx.strokeStyle = `rgba(31,31,31,${(0.34 + lum * 0.5).toFixed(2)})`;
          ctx.lineWidth = lum > 0.62 ? 1.4 : 1;
          ctx.stroke();
        }
        ctx.restore();

        // tests get a target ring so they're impossible to miss; it tightens
        // and breathes as the date closes in
        if (isTest && !it.ghost) {
          const near = hours / 24 <= 7;
          const breathe = near ? 1 + 0.06 * Math.sin(t / 620 + hash01(it.id) * 9) : 1;
          ctx.save();
          ctx.strokeStyle = color;
          ctx.globalAlpha = near ? 0.85 : 0.5;
          ctx.lineWidth = near ? 1.8 : 1.2;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.arc(x, y, (size + 8) * breathe, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          if (near) {
            ctx.globalAlpha = 0.30;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(x, y, (size + 15) * breathe, 0, Math.PI * 2);
            ctx.stroke();
          }
          // tick on the rim marking the bearing the test is coming from
          ctx.globalAlpha = 0.6;
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * R * 0.99, cy + Math.sin(angle) * R * 0.99);
          ctx.lineTo(cx + Math.cos(angle) * (R * 0.99 + 8), cy + Math.sin(angle) * (R * 0.99 + 8));
          ctx.stroke();
          ctx.restore();
        }
        if (overdue) {
          const ph = (t / 1400) % 1;
          ctx.beginPath();
          ctx.strokeStyle = `rgba(224,85,95,${0.5 * (1 - ph)})`;
          ctx.lineWidth = 1.4;
          ctx.arc(x, y, size + ph * 24, 0, Math.PI * 2);
          ctx.stroke();
        }
        // the sweep just went past: a brief soft halo, so the scan reads as
        // actually scanning rather than as decoration
        const behind = (((sweepRef.current - Math.PI / 2 - angle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (!reduced && behind < 0.42) {
          const lift = 1 - behind / 0.42;
          ctx.save();
          ctx.globalAlpha = 0.34 * lift * lift;
          ctx.strokeStyle = it.ghost ? color : '#ffffff';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.arc(x, y, size + 3 + (1 - lift) * 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        const da = Math.abs((((angle - Math.PI / 2 - sweepRef.current) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
        if (da < 0.03 && t - lastPing.current > 3600 && !it.ghost) { lastPing.current = t; sfx.ping(); }
        blips[blips.length - 1].size = size;
      }
      blipsRef.current = blips;

      // ── 4. class identity on the rim: coloured arc + solid name plate ──
      // drawn before the blip labels so their boxes are reserved, and the
      // plates themselves are painted last so nothing can cover a class name
      interface Plate { x: number; y: number; w: number; h: number; label: string; color: string; lit: number }
      const plates: Plate[] = [];
      ctx.font = '800 12.5px "Plus Jakarta Sans", Inter, sans-serif';
      for (const [, s] of sectors) {
        const mid = (s.a0 + s.a1) / 2;
        // how close the sweep is to this sector — the arc lights up in passing
        let d = ((sweepRef.current - Math.PI / 2 - mid) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        const lit = reduced ? 0 : Math.max(0, 1 - d / ((s.a1 - s.a0) / 2 + 0.25));

        ctx.beginPath();
        ctx.strokeStyle = s.color;
        ctx.globalAlpha = 0.30 + lit * 0.55;
        ctx.lineWidth = 3 + lit * 1.6;
        ctx.lineCap = 'butt';
        ctx.arc(cx, cy, R * 1.012, s.a0 + 0.035, s.a1 - 0.035);
        ctx.stroke();
        ctx.globalAlpha = 1;

        const w = ctx.measureText(s.label).width + 17;
        const h = 21;
        const px = cx + Math.cos(mid) * (R + 30) - w / 2;
        const py = cy + Math.sin(mid) * (R + 30) - h / 2;
        plates.push({ x: px, y: py, w, h, label: s.label, color: s.color, lit });
        taken.push({ x0: px - 5, y0: py - 4, x1: px + w + 5, y1: py + h + 4 });
      }

      // ── 5. blip labels: placed by search, never pushed, never leadered ──
      const cands = blips
        .filter(b => !b.it.ghost)
        .map(b => ({
          b,
          hours: (new Date(b.it.due_at!).getTime() - now.getTime()) / 3600000,
        }))
        .filter(c => c.hours < 72 || c.b.isTest || c.b.overdue || hoverRef.current === c.b.it.id)
        .sort((a, b) => {
          const pa = (a.b.overdue ? 0 : a.b.isTest ? 1 : 2), pb = (b.b.overdue ? 0 : b.b.isTest ? 1 : 2);
          return pa !== pb ? pa - pb : a.hours - b.hours;
        })
        .slice(0, MAX_LABELS);

      let hidden = 0;
      for (const { b } of cands) {
        const title = b.it.title.length > 26 ? b.it.title.slice(0, 25) + '…' : b.it.title;
        const delta = humanDelta(new Date(b.it.due_at!).getTime() - now.getTime());
        ctx.font = b.isTest ? '800 11.5px Inter, sans-serif' : '700 11px Inter, sans-serif';
        const tw = ctx.measureText(b.isTest ? `◆ ${title}` : title).width;
        ctx.font = '600 9.5px Inter, sans-serif';
        const dw = ctx.measureText(delta).width;
        const w = Math.max(tw, dw) + 16;
        const h = 27;
        const gap = b.size + 7;

        let placed: Box | null = null;
        let leftOfBlip = false;
        for (const [ux, uy] of CAND) {
          const ax = b.x + ux * gap + (ux < 0 ? -w : ux === 0 ? -w / 2 : 0);
          const ay = b.y + uy * (gap + h / 2) - h / 2;
          const box: Box = { x0: ax, y0: ay, x1: ax + w, y1: ay + h };
          if (box.x0 < 4 || box.x1 > W - 4 || box.y0 < 2 || box.y1 > H - 2) continue;
          if (taken.some(o => hits(box, o))) continue;
          placed = box; leftOfBlip = ux < 0; break;
        }
        if (!placed) { hidden++; continue; }
        taken.push({ x0: placed.x0 - 3, y0: placed.y0 - 3, x1: placed.x1 + 3, y1: placed.y1 + 3 });

        // paper plate + a colour tab so the label reads as this blip's
        roundRect(ctx, placed.x0, placed.y0, w, h, 7);
        ctx.fillStyle = 'rgba(239,239,234,0.94)';
        ctx.fill();
        ctx.strokeStyle = b.overdue ? 'rgba(224,85,95,0.55)' : b.color + '59';
        ctx.lineWidth = 1;
        ctx.stroke();
        // the colour tab sits on the edge facing the blip it belongs to
        roundRect(ctx, leftOfBlip ? placed.x1 - 5.5 : placed.x0 + 3, placed.y0 + 5, 2.5, h - 10, 1.5);
        ctx.fillStyle = b.overdue ? OVERDUE : b.color;
        ctx.fill();

        ctx.textAlign = 'left';
        const tx = placed.x0 + (leftOfBlip ? 8 : 10);
        ctx.font = b.isTest ? '800 11.5px Inter, sans-serif' : '700 11px Inter, sans-serif';
        ctx.fillStyle = b.overdue ? '#b8352c' : INK;
        ctx.fillText(b.isTest ? `◆ ${title}` : title, tx, placed.y0 + 13);
        ctx.font = '600 9.5px Inter, sans-serif';
        ctx.fillStyle = b.overdue ? '#b8352c' : (lightness(b.color) > 0.6 ? '#6b6b64' : b.color);
        ctx.fillText(delta, tx, placed.y0 + 23);
      }

      // ── 6. name plates last: a class name is never covered ──
      for (const p of plates) {
        roundRect(ctx, p.x, p.y, p.w, p.h, 10.5);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 0.92 + p.lit * 0.08;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = PAPER;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = '800 12.5px "Plus Jakarta Sans", Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = onColor(p.color);
        ctx.fillText(p.label, p.x + p.w / 2, p.y + 14.5);
      }

      // ── 7. counters ──
      ctx.textAlign = 'center';
      if (overCount) {
        ctx.font = '800 11px Inter, sans-serif';
        ctx.lineWidth = 3.6; ctx.lineJoin = 'round';
        ctx.strokeStyle = PAPER;
        ctx.strokeText(`${overCount} OVERDUE`, cx, cy + R * 0.13 + 15);
        ctx.fillStyle = OVERDUE;
        ctx.fillText(`${overCount} OVERDUE`, cx, cy + R * 0.13 + 15);
        ctx.lineWidth = 1;
      }
      if (hidden > 0) {
        ctx.font = '600 10px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#8b8b83';
        ctx.fillText(`+${hidden} more — hover to name`, 4, H - 6);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active, classById, sectors, now]);

  const pick = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    return blipsRef.current.find(b => Math.hypot(b.x - mx, b.y - my) < Math.max(11, b.size + 6)) ?? null;
  };
  const onMove = (e: React.MouseEvent) => {
    const hit = pick(e);
    setTip(hit ? { x: e.clientX, y: e.clientY, it: hit.it } : null);
    setHover(hit ? hit.it.id : null);
  };
  const onClick = (e: React.MouseEvent) => {
    const hit = pick(e);
    if (hit) openDetail(hit.it.id);
  };

  const k = tip ? data.classes.find(c => c.id === tip.it.class_id) : null;

  return (
    <div ref={wrapRef} className="radar-wrap view-enter" style={{ height: 'calc(100vh - 130px)', minHeight: 520 }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', cursor: 'crosshair' }}
        onMouseMove={onMove}
        onMouseLeave={() => { setTip(null); setHover(null); }}
        onClick={onClick}
      />
      {tip && (
        <div className="blip-tip corner" style={{ left: tip.x + 14, top: tip.y + 10 }}>
          <i className="c3" />
          <div className="micro" style={{ color: k?.color ?? LIFE, fontWeight: 600 }}>
            {k?.code ?? 'LIFE'} · {TYPE_GLYPH[tip.it.type]}{tip.it.ghost ? ' · PROPOSED' : ''}{tip.it.at_home === false ? ' · IN-CLASS' : ''}
          </div>
          <div style={{ fontWeight: 700, margin: '4px 0 2px' }}>{tip.it.title}</div>
          <div className="mono dim" style={{ fontSize: 11 }}>
            {tip.it.due_at ? `${fmtEt(new Date(tip.it.due_at), 'EEE MMM d · HH:mm')} — ${humanDelta(new Date(tip.it.due_at).getTime() - now.getTime())}` : 'no date'}
          </div>
          {tip.it.details && <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>{tip.it.details.slice(0, 90)}</div>}
        </div>
      )}
    </div>
  );
}
