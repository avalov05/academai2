'use client';
// ── APPROACH RADAR: every obligation is an inbound object ─────────────────
//
// VISUAL REBUILD — the compute layer below (position math, urgency mapping,
// label-collision search, hit-testing) is untouched line-for-line from the
// previous version: distance-from-center = urgency is the entire spatial
// grammar of this feature and nothing about that changed. What changed is
// how it's painted:
//   - the scope now sits inside a real glass dome (`.radar-dome`, a DOM
//     layer behind the canvas with an actual backdrop-blur — canvas pixels
//     can't fake optical blur of what's behind them, so the glass is a real
//     CSS layer, not a gradient pretending to be one)
//   - every colour the canvas draws is read from the page's own CSS
//     variables at draw time, so the scope now actually adapts to dark mode
//     instead of always painting a light-theme "PAPER" backing behind labels
//   - blips carry a permanent soft glow scaled by urgency, rings carry a
//     highlight arc to read as an embossed groove instead of a flat dashed
//     circle, and the sweep is brighter and throws real light onto what it
//     passes
//
// Reading order, deliberately unchanged: the sweep sits *behind* the grid so
// it never washes out the rings; class identity lives on the rim as a
// coloured arc and a solid name plate; blips sit on top; labels are placed
// by search, never by pushing — a label that cannot find clear space is
// simply not drawn, so no leader line ever crosses the scope.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppContext';
import type { Item } from '@/lib/types';
import { itemImpact, urgencyFromHours, inDangerZone, URGENCY, type Urgency } from '@/lib/types';
import { isActive } from '@/lib/planner';
import { humanDelta, fmtEt } from '@/lib/time';
import { sfx } from '@/lib/sound';
import { TYPE_GLYPH } from '@/lib/palette';
import { IS_DEMO } from '@/lib/store';

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
/** '#rrggbb' → 'r,g,b', for building rgba() strings the canvas can animate
    the alpha channel of. Falls back to a mid-grey if the token is somehow
    unresolved (a var() that didn't compute, e.g. mid-hydration). */
function hexToRgb(hex: string): string {
  const h = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '140,140,134';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}
/** midpoint of two hex colours, component-wise — used for the one blended
    tone (zone↔critical) the old fixed palette had that doesn't map 1:1 to
    a single design token. */
function blendHex(a: string, b: string): string {
  const pa = a.replace('#', ''), pb = b.replace('#', '');
  const mix = (i: number) => Math.round((parseInt(pa.slice(i, i + 2), 16) + parseInt(pb.slice(i, i + 2), 16)) / 2);
  return `${mix(0)},${mix(2)},${mix(4)}`;
}

// hours-until-due → radius fraction (piecewise) — distance from centre IS
// urgency; this table is the entire spatial grammar of the radar.
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
  urg: Urgency;
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

// ── theme bridge ───────────────────────────────────────────────────────────
// Canvas fillStyle/strokeStyle can't resolve `var(--x)` the way a DOM
// element's CSS can, so the palette this scope paints with is read from the
// page's resolved custom properties into plain hex/rgb strings, refreshed
// whenever the theme changes. Fallbacks mirror :root's light defaults, so a
// server-rendered first frame (before this effect runs) never reads `undefined`.
interface RadarPalette {
  bg: string; paper: string; text: string; dim: string; faint: string;
  line: string; lineStrong: string;
  danger: string; ok: string; acc: string;
  zone: string; zoneInk: string; critical: string; criticalInk: string; overInk: string;
  life: string;
}
const FALLBACK_PALETTE: RadarPalette = {
  bg: '#efefea', paper: '#ffffff', text: '#171717', dim: '#5d5d58', faint: '#6a6a63',
  line: '#dedcd4', lineStrong: '#cfcfc6',
  danger: '#b5342a', ok: '#1a624b', acc: '#5b49c4',
  zone: '#e08a3c', zoneInk: '#82450f', critical: '#e0555f', criticalInk: '#ad322a', overInk: '#9d2119',
  life: '#7C7C76',
};
function readPalette(): RadarPalette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => { const val = cs.getPropertyValue(name).trim(); return val || fallback; };
  const bg = v('--bg', FALLBACK_PALETTE.bg);
  const dark = lightness(/^#[0-9a-f]{6}$/i.test(bg) ? bg : FALLBACK_PALETTE.bg) < 0.5;
  return {
    bg, paper: v('--paper', FALLBACK_PALETTE.paper), text: v('--text', FALLBACK_PALETTE.text),
    dim: v('--dim', FALLBACK_PALETTE.dim), faint: v('--faint', FALLBACK_PALETTE.faint),
    line: v('--line', FALLBACK_PALETTE.line), lineStrong: v('--line-strong', FALLBACK_PALETTE.lineStrong),
    danger: v('--danger', FALLBACK_PALETTE.danger), ok: v('--ok', FALLBACK_PALETTE.ok), acc: v('--acc', FALLBACK_PALETTE.acc),
    zone: v('--zone', FALLBACK_PALETTE.zone), zoneInk: v('--zone-ink', FALLBACK_PALETTE.zoneInk),
    critical: v('--critical', FALLBACK_PALETTE.critical), criticalInk: v('--critical-ink', FALLBACK_PALETTE.criticalInk),
    overInk: v('--over-ink', FALLBACK_PALETTE.overInk),
    life: dark ? '#96968c' : '#7C7C76',
  };
}

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
  const paletteRef = useRef<RadarPalette>(FALLBACK_PALETTE);

  const active = useMemo(() =>
    data.items.filter(i => isActive(i) || (i.ghost && i.status === 'pending')).filter(i => i.due_at),
  [data.items]);

  const classById = useMemo(() => new Map(data.classes.map(c => [c.id, c])), [data.classes]);

  // sectors: one per class + LIFE. The LIFE sector's colour is theme-
  // dependent (a neutral grey that flips between light/dark), so it's left
  // as a sentinel here and resolved from the live palette at draw time —
  // otherwise a theme toggle wouldn't repaint it until `data.classes` itself
  // happened to change.
  const LIFE_SENTINEL = '\0life';
  const sectors = useMemo(() => {
    const ids = [...data.classes.map(c => c.id), 'LIFE'];
    const w = (Math.PI * 2) / ids.length;
    const map = new Map<string, { a0: number; a1: number; label: string; color: string }>();
    ids.forEach((id, i) => {
      const a0 = -Math.PI / 2 + i * w;
      const k = classById.get(id);
      map.set(id, { a0, a1: a0 + w, label: k ? k.code : 'LIFE', color: k ? k.color : LIFE_SENTINEL });
    });
    return map;
  }, [data.classes, classById]);

  useEffect(() => { hoverRef.current = hover; }, [hover]);

  // keep the palette in sync with the theme — system preference changes and
  // the explicit toggle both flip `data-theme` on <html>, same pattern the
  // page background canvas uses.
  useEffect(() => {
    const sync = () => { paletteRef.current = readPalette(); };
    sync();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', sync);
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { mq.removeEventListener('change', sync); obs.disconnect(); };
  }, []);

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

      const pal = paletteRef.current;
      const INK = hexToRgb(pal.text);
      const SWEEP = hexToRgb(pal.acc);             // the sweep takes the accent colour
      const OVERDUE_RGB = hexToRgb(pal.critical);   // == old fixed OVERDUE constant, now theme-aware
      const DANGER_RGB = hexToRgb(pal.zone);        // == old fixed DANGER constant, now theme-aware
      const ZONE_CRIT_RGB = blendHex(pal.zone, pal.critical);

      // ── 1. sweep, drawn first so the grid stays crisp on top of it ──
      if (!reduced) sweepRef.current = (t / 6400) % (Math.PI * 2);
      const sw = sweepRef.current - Math.PI / 2;
      if (ctx.createConicGradient) {
        // the bright edge lands exactly on the line: the tail is the only
        // thing behind it, so line and glow read as one object
        const g = ctx.createConicGradient(sw - TRAIL, cx, cy);
        const edge = TRAIL / (Math.PI * 2);
        g.addColorStop(0, `rgba(${SWEEP},0)`);
        g.addColorStop(edge * 0.45, `rgba(${SWEEP},0.05)`);
        g.addColorStop(edge * 0.82, `rgba(${SWEEP},0.14)`);
        g.addColorStop(edge, `rgba(${SWEEP},0.26)`);
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
      // the line itself, matched to the wedge it leads — brighter core than
      // before so it reads as a lit instrument sweep, not a faint hairline
      const lg = ctx.createLinearGradient(cx, cy, cx + Math.cos(sw) * R, cy + Math.sin(sw) * R);
      lg.addColorStop(0, `rgba(${SWEEP},0)`);
      lg.addColorStop(0.28, `rgba(${SWEEP},0.42)`);
      lg.addColorStop(0.85, `rgba(${SWEEP},0.75)`);
      lg.addColorStop(1, `rgba(${SWEEP},0.24)`);
      ctx.strokeStyle = lg;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sw) * R * 0.985, cy + Math.sin(sw) * R * 0.985);
      ctx.stroke();
      // head — a small glowing node, the sweep's own leading light
      const headX = cx + Math.cos(sw) * R * 0.985, headY = cy + Math.sin(sw) * R * 0.985;
      const headGlow = ctx.createRadialGradient(headX, headY, 0, headX, headY, 9);
      headGlow.addColorStop(0, `rgba(${SWEEP},0.9)`);
      headGlow.addColorStop(1, `rgba(${SWEEP},0)`);
      ctx.fillStyle = headGlow;
      ctx.beginPath();
      ctx.arc(headX, headY, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${SWEEP},0.9)`;
      ctx.beginPath();
      ctx.arc(headX, headY, 2.6, 0, Math.PI * 2);
      ctx.fill();

      // ── 2. rings ──
      // ── 1b. the danger zone: everything inside the 24H ring ──
      // Under 24 hours a missed item is usually unrecoverable, so the band is
      // drawn as territory, not as a line. It sits quiet when empty and lifts
      // when something is actually in it.
      const nowMs = now.getTime();
      const inZone = active.filter(i => !i.ghost
        && (new Date(i.due_at!).getTime() - nowMs) / 3600000 <= 24);
      const overdueNow = inZone.filter(i => new Date(i.due_at!).getTime() <= nowMs);
      const occupancy = Math.min(1, inZone.length / 4);
      const breath = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t / 1500);
      const zoneAlpha = 0.030 + occupancy * (0.055 + breath * 0.035);

      const zone = ctx.createRadialGradient(cx, cy, R * 0.04, cx, cy, R * 0.34);
      zone.addColorStop(0, `rgba(${OVERDUE_RGB},${(zoneAlpha * 1.5).toFixed(3)})`);
      zone.addColorStop(0.55, `rgba(${ZONE_CRIT_RGB},${zoneAlpha.toFixed(3)})`);
      zone.addColorStop(0.88, `rgba(${DANGER_RGB},${(zoneAlpha * 0.85).toFixed(3)})`);
      zone.addColorStop(1, `rgba(${DANGER_RGB},0)`);
      ctx.fillStyle = zone;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.34, 0, Math.PI * 2);
      ctx.fill();

      // a slow sweep of light around the band's edge while it is occupied —
      // motion is the thing peripheral vision actually catches
      if (inZone.length && !reduced) {
        const a = (t / 2600) % (Math.PI * 2);
        const edge = ctx.createConicGradient(a, cx, cy);
        edge.addColorStop(0, `rgba(${OVERDUE_RGB},${(0.30 + occupancy * 0.3).toFixed(2)})`);
        edge.addColorStop(0.14, `rgba(${DANGER_RGB},0.05)`);
        edge.addColorStop(1, `rgba(${DANGER_RGB},0)`);
        ctx.strokeStyle = edge;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.34, 0, Math.PI * 2);
        ctx.stroke();
      }

      let zoneLabel: { text: string; y: number } | null = null;
      const rings: Array<[number, string]> = [[0.13, 'NOW'], [0.34, '24H'], [0.52, '3D'], [0.70, '1W'], [0.85, '2W'], [0.965, '3W+']];
      ctx.lineWidth = 1.2;
      for (const [f, label] of rings) {
        const isZoneEdge = f === 0.34;
        // ── the glass groove: a soft highlight riding the ring's upper-left
        // quadrant, as if a single light source were catching an embossed
        // channel in the glass. Neumorphic depth cue, purely additive —
        // the functional dashed stroke underneath is unchanged. ──
        if (!isZoneEdge && f !== 0.13) {
          const hi = ctx.createConicGradient(-Math.PI * 0.75, cx, cy);
          hi.addColorStop(0, `rgba(255,255,255,0)`);
          hi.addColorStop(0.12, `rgba(255,255,255,${lightness(pal.bg) < 0.5 ? 0.07 : 0.5})`);
          hi.addColorStop(0.26, `rgba(255,255,255,0)`);
          hi.addColorStop(1, `rgba(255,255,255,0)`);
          ctx.beginPath();
          ctx.strokeStyle = hi;
          ctx.lineWidth = 2.4;
          ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.strokeStyle = f === 0.13 ? `rgba(${OVERDUE_RGB},0.62)`
          : isZoneEdge ? `rgba(${ZONE_CRIT_RGB},${inZone.length ? 0.78 : 0.42})`
          : (f === 0.965 ? `rgba(${INK},0.40)` : `rgba(${INK},0.20)`);
        ctx.lineWidth = isZoneEdge ? 1.6 : 1.2;
        ctx.setLineDash(f === 0.965 ? [] : isZoneEdge ? [6, 4] : [3, 5]);
        // marching dashes: the boundary itself is moving, so the zone reads as
        // live rather than as another grid line
        ctx.lineDashOffset = isZoneEdge && !reduced ? -(t / 90) % 10 : 0;
        ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        const hotEdge = isZoneEdge && inZone.length > 0;
        const text = hotEdge ? '24H — DANGER ZONE' : label;
        ctx.font = hotEdge ? '800 10.5px Inter, sans-serif' : '700 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        const halfW = ctx.measureText(text).width / 2 + 6;
        taken.push({ x0: cx - halfW, y0: cy - R * f - 15, x1: cx + halfW, y1: cy - R * f + 1 });
        // the zone label is painted after the blips — a blip parked on the ring
        // must not be allowed to sit on top of the words "DANGER ZONE"
        if (hotEdge) { zoneLabel = { text, y: cy - R * f - 5 }; continue; }
        ctx.lineWidth = 3.4; ctx.lineJoin = 'round';
        ctx.strokeStyle = pal.bg;
        ctx.strokeText(text, cx, cy - R * f - 5);
        ctx.fillStyle = pal.faint;
        ctx.fillText(text, cx, cy - R * f - 5);
        ctx.lineWidth = 1.2;
      }
      // sector separators
      for (const [, s] of sectors) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${INK},0.14)`;
        ctx.lineWidth = 1;
        ctx.moveTo(cx + Math.cos(s.a0) * R * 0.13, cy + Math.sin(s.a0) * R * 0.13);
        ctx.lineTo(cx + Math.cos(s.a0) * R, cy + Math.sin(s.a0) * R);
        ctx.stroke();
      }
      // crosshair
      ctx.strokeStyle = `rgba(${INK},0.55)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 7, cy); ctx.lineTo(cx + 7, cy);
      ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy + 7);
      ctx.stroke();
      taken.push({ x0: cx - 30, y0: cy - 16, x1: cx + 30, y1: cy + 30 });
      // the overdue counter is painted last but its space is claimed now, so a
      // label can never land on top of the one number that must stay readable
      const overCount = active.filter(i => !i.ghost && new Date(i.due_at!).getTime() <= now.getTime()).length;
      if (overCount || inZone.length) taken.push({ x0: cx - 95, y0: cy + R * 0.13 + 3, x1: cx + 95, y1: cy + R * 0.13 + 34 });

      // ── 3. blips ──
      const blips: Blip[] = [];
      for (const it of active) {
        const hours = (new Date(it.due_at!).getTime() - now.getTime()) / 3600000;
        const overdue = hours <= 0 && !it.ghost;
        const secId = it.class_id && sectors.has(it.class_id) ? it.class_id : 'LIFE';
        const s = sectors.get(secId)!;
        const pad = (s.a1 - s.a0) * 0.14;
        const angle = s.a0 + pad + hash01(it.id) * (s.a1 - s.a0 - pad * 2);
        // Position is a pure function of the item and the clock — never of the
        // frame. Overdue blips used to be nudged a few pixels per frame, which
        // read as the blip *and its label* shaking, and made the label
        // placement search re-solve every frame on top of that.
        const r = R * (overdue ? 0.05 + hash01(it.id) * 0.04 : rFrac(hours));
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        const urg: Urgency = it.ghost ? 'normal' : urgencyFromHours(hours);
        // a "test" is anything you sit for: an exam, or an in-class quiz
        const isTest = it.type === 'exam' || (it.type === 'quiz' && it.at_home === false);
        const size = (5 + itemImpact(it) * 9.5) * (isTest ? 1.5 : 1);
        const color = overdue ? pal.critical : (classById.get(it.class_id ?? '')?.color ?? pal.life);
        const alert = overdue ? OVERDUE_RGB : urg === 'critical' ? OVERDUE_RGB : DANGER_RGB;
        blips.push({ it, x, y, size, color, overdue, angle, r, isTest, urg });

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

        // ── permanent glow node: distance from centre IS urgency, and now
        // the glow says the same thing — closer in, brighter halo. This is
        // the "glowing node marker" the scope is built around; everything
        // else (rings, sweep, chrome) exists to give it a stage. ──
        const urgencyLift = Math.max(0, 1 - r / (R * 0.7));
        const glowColor = overdue ? OVERDUE_RGB : hexToRgb(color);
        const glowR = size * (2.4 + urgencyLift * 1.4);
        const glowA = (it.ghost ? 0.10 : 0.22) + urgencyLift * (it.ghost ? 0.06 : 0.20);
        const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
        glow.addColorStop(0, `rgba(${glowColor},${glowA.toFixed(3)})`);
        glow.addColorStop(1, `rgba(${glowColor},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, glowR, 0, Math.PI * 2);
        ctx.fill();

        // shape by type
        ctx.save();
        ctx.translate(x, y);
        const pulse = 1 + (overdue ? 0.10 * Math.sin(t / 520) : 0.05 * Math.sin(t / 460 + hash01(it.id) * 20));
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
          // a bright arc on the upper-left edge — the same single light
          // source the rings catch, now landing on the node itself so it
          // reads as a lit sphere/tile rather than a flat sticker
          ctx.save();
          ctx.clip();
          const hiGrad = ctx.createRadialGradient(-size * 0.4, -size * 0.4, 0, -size * 0.4, -size * 0.4, size * 1.6);
          hiGrad.addColorStop(0, 'rgba(255,255,255,0.55)');
          hiGrad.addColorStop(0.5, 'rgba(255,255,255,0.08)');
          hiGrad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = hiGrad;
          ctx.fillRect(-size * 2, -size * 2, size * 4, size * 4);
          ctx.restore();
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
        // ── under 24 hours: a ring that closes in on the blip ──
        // Contraction, not vibration. It reads as something arriving, and the
        // rate is the message: slower at 24h, twice as fast in the last hours.
        if (!it.ghost && !overdue && inDangerZone(urg) && !reduced) {
          const period = urg === 'critical' ? 1050 : 1900;
          const ringCount = urg === 'critical' ? 2 : 1;
          for (let n = 0; n < ringCount; n++) {
            const ph = ((t / period) + n / ringCount) % 1;
            const rad = size + 5 + (1 - ph) * 26;      // wide → tight
            ctx.beginPath();
            ctx.strokeStyle = `rgb(${alert})`;
            ctx.globalAlpha = 0.55 * Math.sin(ph * Math.PI);   // fade in and out
            ctx.lineWidth = 1.3 + ph * 1.1;
            ctx.arc(x, y, rad, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }

        // ── overdue: a scorch mark and shockwaves, and it does not move ──
        if (overdue) {
          const scorch = ctx.createRadialGradient(x, y, size * 0.5, x, y, size + 26);
          scorch.addColorStop(0, `rgba(${OVERDUE_RGB},0.28)`);
          scorch.addColorStop(1, `rgba(${OVERDUE_RGB},0)`);
          ctx.fillStyle = scorch;
          ctx.beginPath();
          ctx.arc(x, y, size + 26, 0, Math.PI * 2);
          ctx.fill();
          if (!reduced) {
            for (let n = 0; n < 2; n++) {
              const ph = ((t / 1500) + n / 2) % 1;
              ctx.beginPath();
              ctx.strokeStyle = `rgba(${OVERDUE_RGB},${(0.55 * (1 - ph)).toFixed(3)})`;
              ctx.lineWidth = 1.6;
              ctx.arc(x, y, size + ph * 26, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
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
      // demo builds only: lets the test suite assert that a blip's position is
      // a function of the item and the clock, never of the frame
      if (IS_DEMO) {
        (window as unknown as { __blips?: unknown }).__blips =
          blips.map(b => ({ id: b.it.id, title: b.it.title, x: b.x, y: b.y, urg: b.urg }));
      }

      // ── 4. class identity on the rim: coloured arc + solid name plate ──
      // drawn before the blip labels so their boxes are reserved, and the
      // plates themselves are painted last so nothing can cover a class name
      interface Plate { x: number; y: number; w: number; h: number; label: string; color: string; lit: number }
      const plates: Plate[] = [];
      ctx.font = '800 12.5px "Plus Jakarta Sans", Inter, sans-serif';
      for (const [, s] of sectors) {
        const sectorColor = s.color === LIFE_SENTINEL ? pal.life : s.color;
        const mid = (s.a0 + s.a1) / 2;
        // how close the sweep is to this sector — the arc lights up in passing
        let d = ((sweepRef.current - Math.PI / 2 - mid) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        const lit = reduced ? 0 : Math.max(0, 1 - d / ((s.a1 - s.a0) / 2 + 0.25));

        ctx.beginPath();
        ctx.strokeStyle = sectorColor;
        ctx.globalAlpha = 0.30 + lit * 0.55;
        ctx.lineWidth = 3 + lit * 1.6;
        ctx.lineCap = 'butt';
        ctx.arc(cx, cy, R * 1.012, s.a0 + 0.035, s.a1 - 0.035);
        ctx.stroke();
        // a soft bloom on the arc while the sweep is passing — the rim
        // itself lights up, not just a flat colour change
        if (lit > 0.05) {
          ctx.save();
          ctx.shadowColor = sectorColor;
          ctx.shadowBlur = 10 * lit;
          ctx.globalAlpha = lit * 0.7;
          ctx.stroke();
          ctx.restore();
        }
        ctx.globalAlpha = 1;

        const w = ctx.measureText(s.label).width + 17;
        const h = 21;
        const px = cx + Math.cos(mid) * (R + 30) - w / 2;
        const py = cy + Math.sin(mid) * (R + 30) - h / 2;
        plates.push({ x: px, y: py, w, h, label: s.label, color: sectorColor, lit });
        taken.push({ x0: px - 5, y0: py - 4, x1: px + w + 5, y1: py + h + 4 });
      }

      // ── 5. blip labels: placed by search, never pushed, never leadered ──
      const cands = blips
        .filter(b => !b.it.ghost)
        .map(b => ({
          b,
          hours: (new Date(b.it.due_at!).getTime() - now.getTime()) / 3600000,
        }))
        .filter(c => c.hours < 72 || c.b.isTest || inDangerZone(c.b.urg) || hoverRef.current === c.b.it.id)
        .sort((a, b) => {
          const rank = (x: typeof a) => inDangerZone(x.b.urg) ? 0 : x.b.isTest ? 1 : 2;
          const pa = rank(a), pb = rank(b);
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

        // glass plate + a colour tab so the label reads as this blip's
        const hot = inDangerZone(b.urg);
        const hotInk = b.urg === 'overdue' ? pal.overInk : b.urg === 'critical' ? pal.criticalInk : pal.zoneInk;
        const hotLine = URGENCY[b.urg].line;
        roundRect(ctx, placed.x0, placed.y0, w, h, 7);
        ctx.fillStyle = hot ? `color-mix(in srgb, ${pal.critical} 13%, ${pal.bg})` : `color-mix(in srgb, ${pal.bg} 94%, transparent)`;
        ctx.fill();
        ctx.strokeStyle = hot ? hotLine : b.color + '59';
        ctx.lineWidth = hot ? 1.4 : 1;
        ctx.stroke();
        // the colour tab sits on the edge facing the blip it belongs to
        roundRect(ctx, leftOfBlip ? placed.x1 - 5.5 : placed.x0 + 3, placed.y0 + 5, 2.5, h - 10, 1.5);
        ctx.fillStyle = hot ? hotLine : b.color;
        ctx.fill();

        ctx.textAlign = 'left';
        const tx = placed.x0 + (leftOfBlip ? 8 : 10);
        ctx.font = b.isTest ? '800 11.5px Inter, sans-serif' : '700 11px Inter, sans-serif';
        ctx.fillStyle = hot ? hotInk : pal.text;
        ctx.fillText(b.isTest ? `◆ ${title}` : title, tx, placed.y0 + 13);
        ctx.font = hot ? '800 9.5px Inter, sans-serif' : '600 9.5px Inter, sans-serif';
        ctx.fillStyle = hot ? hotInk : (lightness(b.color) > 0.6 ? pal.dim : b.color);
        ctx.fillText(hot && b.urg !== 'overdue' ? `${delta} left` : delta, tx, placed.y0 + 23);
      }

      // ── 6. name plates last: a class name is never covered ──
      if (zoneLabel) {
        ctx.font = '800 10.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 4; ctx.lineJoin = 'round';
        ctx.strokeStyle = pal.bg;
        ctx.strokeText(zoneLabel.text, cx, zoneLabel.y);
        ctx.fillStyle = pal.overInk;
        ctx.fillText(zoneLabel.text, cx, zoneLabel.y);
        ctx.lineWidth = 1;
      }
      for (const p of plates) {
        roundRect(ctx, p.x, p.y, p.w, p.h, 10.5);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 0.92 + p.lit * 0.08;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = pal.bg;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = '800 12.5px "Plus Jakarta Sans", Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = onColor(p.color);
        ctx.fillText(p.label, p.x + p.w / 2, p.y + 14.5);
      }

      // ── 7. counters ──
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      if (overCount) {
        ctx.font = '800 11.5px Inter, sans-serif';
        ctx.lineWidth = 3.6;
        ctx.strokeStyle = pal.bg;
        ctx.strokeText(`${overCount} OVERDUE`, cx, cy + R * 0.13 + 15);
        ctx.fillStyle = pal.critical;
        ctx.fillText(`${overCount} OVERDUE`, cx, cy + R * 0.13 + 15);
        ctx.lineWidth = 1;
      }
      const soonCount = inZone.length - overdueNow.length;
      if (soonCount > 0) {
        const y0 = cy + R * 0.13 + (overCount ? 29 : 15);
        const msg = `${soonCount} INSIDE 24H`;
        ctx.font = '800 11px Inter, sans-serif';
        ctx.lineWidth = 3.6;
        ctx.strokeStyle = pal.bg;
        ctx.strokeText(msg, cx, y0);
        ctx.fillStyle = pal.zoneInk;
        ctx.fillText(msg, cx, y0);
        ctx.lineWidth = 1;
      }
      if (hidden > 0) {
        ctx.font = '600 10px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillStyle = pal.faint;
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

  // A screen-reader-only bridge: the scope itself is a picture, not an
  // interactive list, so anyone not pointing at it gets an equivalent count
  // and a direct route to the same items as real rows in the Manifest table.
  const overdueA11y = active.filter(i => !i.ghost && new Date(i.due_at!).getTime() <= now.getTime()).length;
  const zoneA11y = active.filter(i => !i.ghost
    && (new Date(i.due_at!).getTime() - now.getTime()) / 3600000 <= 24
    && new Date(i.due_at!).getTime() > now.getTime()).length;

  return (
    <div ref={wrapRef} className="radar-wrap view-enter" style={{ height: 'calc(100vh - 130px)', minHeight: 520 }}>
      <p className="sr-only">
        Radar view: {active.length} active items plotted by urgency, {overdueA11y} overdue, {zoneA11y} due within
        24 hours. This is a visual scope; open the Manifest tab for the same items as a sortable, keyboard-navigable table.
      </p>
      <div className="radar-dome" aria-hidden="true" />
      <span className="radar-corner tl" aria-hidden="true" />
      <span className="radar-corner tr" aria-hidden="true" />
      <span className="radar-corner bl" aria-hidden="true" />
      <span className="radar-corner br" aria-hidden="true" />
      <span className="radar-readout" aria-hidden="true">SCOPE · {active.length} TRACKED</span>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ width: '100%', height: '100%', cursor: 'crosshair' }}
        onMouseMove={onMove}
        onMouseLeave={() => { setTip(null); setHover(null); }}
        onClick={onClick}
      />
      {tip && (
        <div className="blip-tip corner" style={{ left: tip.x + 14, top: tip.y + 10, borderLeft: `3px solid ${k?.color ?? '#8A8A84'}` }}>
          <i className="c3" />
          <div className="micro" style={{ color: k?.color ?? '#8A8A84', fontWeight: 600 }}>
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
