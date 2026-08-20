'use client';
// ── APPROACH RADAR: every obligation is an inbound object ─────────────────
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from './AppContext';
import type { Item } from '@/lib/types';
import { itemImpact } from '@/lib/types';
import { isActive } from '@/lib/planner';
import { humanDelta, fmtEt } from '@/lib/time';
import { sfx } from '@/lib/sound';
import { TYPE_GLYPH } from '@/lib/palette';

const LIFE = '#7A7A88';
const INK = '#292929';
const OVERDUE = '#E4566E';

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
  it: Item; x: number; y: number; px: number; py: number; size: number;
  color: string; overdue: boolean; angle: number; r: number;
}

export default function Radar() {
  const { data, now, openDetail } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const blipsRef = useRef<Blip[]>([]);
  const [tip, setTip] = useState<{ x: number; y: number; it: Item } | null>(null);
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

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== rect.width * dpr) { canvas.width = rect.width * dpr; canvas.height = rect.height * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = rect.width, H = rect.height;
      const cx = W / 2, cy = H / 2;
      const R = Math.min(W, H) / 2 - 34;
      ctx.clearRect(0, 0, W, H);

      // rings
      const rings: Array<[number, string]> = [[0.13, 'NOW'], [0.34, '24H'], [0.52, '3D'], [0.70, '1W'], [0.85, '2W'], [0.965, '3W+']];
      ctx.lineWidth = 1;
      for (const [f, label] of rings) {
        ctx.beginPath();
        ctx.strokeStyle = f === 0.13 ? 'rgba(228,86,110,0.34)' : 'rgba(41,41,41,0.13)';
        ctx.setLineDash(f === 0.965 ? [] : [2, 6]);
        ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '500 9px Inter, sans-serif';
        ctx.fillStyle = 'rgba(41,41,41,0.34)';
        ctx.textAlign = 'center';
        ctx.fillText(label, cx, cy - R * f - 5);
      }
      // sector separators + labels
      for (const [, s] of sectors) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(41,41,41,0.09)';
        ctx.moveTo(cx + Math.cos(s.a0) * R * 0.13, cy + Math.sin(s.a0) * R * 0.13);
        ctx.lineTo(cx + Math.cos(s.a0) * R, cy + Math.sin(s.a0) * R);
        ctx.stroke();
        const mid = (s.a0 + s.a1) / 2;
        ctx.save();
        ctx.font = '600 10px Inter, sans-serif';
        ctx.fillStyle = s.color;
        ctx.globalAlpha = 0.85;
        ctx.textAlign = 'center';
        const lx = cx + Math.cos(mid) * (R + 20), ly = cy + Math.sin(mid) * (R + 20);
        ctx.fillText(s.label, lx, ly + 3);
        ctx.restore();
      }
      // crosshair
      ctx.strokeStyle = 'rgba(41,41,41,0.34)';
      ctx.beginPath();
      ctx.moveTo(cx - 7, cy); ctx.lineTo(cx + 7, cy);
      ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy + 7);
      ctx.stroke();

      // sweep
      if (!reduced) sweepRef.current = (t / 5200) % (Math.PI * 2);
      const sw = sweepRef.current - Math.PI / 2;
      const grad = ctx.createConicGradient ? (() => {
        const g = ctx.createConicGradient(sw - 0.9, cx, cy);
        g.addColorStop(0, 'rgba(155,169,247,0)');
        g.addColorStop(0.12, 'rgba(155,169,247,0.14)');
        g.addColorStop(0.125, 'rgba(155,169,247,0)');
        g.addColorStop(1, 'rgba(155,169,247,0)');
        return g;
      })() : null;
      if (grad) {
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R * 0.965, 0, Math.PI * 2);
        ctx.fill();
      }
      const swGrad = ctx.createLinearGradient(cx, cy, cx + Math.cos(sw) * R, cy + Math.sin(sw) * R);
      swGrad.addColorStop(0, 'rgba(41,41,41,0.30)');
      swGrad.addColorStop(1, 'rgba(155,169,247,0)');
      ctx.strokeStyle = swGrad;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sw) * R * 0.965, cy + Math.sin(sw) * R * 0.965);
      ctx.stroke();
      ctx.lineWidth = 1;

      // blips
      const blips: Blip[] = [];
      const labels: Array<{
        x: number; y: number; size: number; right: boolean; overdue: boolean;
        title: string; delta: string;
      }> = [];
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
        const size = 3.5 + itemImpact(it) * 9;
        const color = overdue ? OVERDUE : (classById.get(it.class_id ?? '')?.color ?? LIFE);
        blips.push({ it, x, y, px: x, py: y, size, color, overdue, angle, r });

        // inbound trajectory trail
        if (!overdue) {
          ctx.beginPath();
          ctx.strokeStyle = color + '4D';
          ctx.lineWidth = 1;
          ctx.setLineDash(it.ghost ? [2, 4] : []);
          const tr = r + 14 + itemImpact(it) * 10;
          ctx.moveTo(cx + Math.cos(angle) * Math.min(tr, R * 0.98), cy + Math.sin(angle) * Math.min(tr, R * 0.98));
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // shape by type
        ctx.save();
        ctx.translate(x, y);
        const pulse = 1 + (overdue ? 0.22 * Math.sin(t / 130) : 0.06 * Math.sin(t / 400 + hash01(it.id) * 20));
        ctx.scale(pulse, pulse);
        ctx.beginPath();
        if (it.type === 'exam') { ctx.moveTo(0, -size); ctx.lineTo(size, 0); ctx.lineTo(0, size); ctx.lineTo(-size, 0); ctx.closePath(); }
        else if (it.type === 'project') { ctx.rect(-size * 0.8, -size * 0.8, size * 1.6, size * 1.6); }
        else if (it.type === 'quiz') { ctx.moveTo(0, -size); ctx.lineTo(size * 0.95, size * 0.75); ctx.lineTo(-size * 0.95, size * 0.75); ctx.closePath(); }
        else { ctx.arc(0, 0, size * 0.85, 0, Math.PI * 2); }
        if (it.ghost) {
          ctx.strokeStyle = color + '99'; ctx.lineWidth = 1.3; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
        } else {
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = 'rgba(250,249,246,0.95)'; ctx.lineWidth = 1.4; ctx.stroke();
        }
        ctx.restore();
        // overdue alert rings
        if (overdue) {
          const ph = (t / 1400) % 1;
          ctx.beginPath();
          ctx.strokeStyle = `rgba(228,86,110,${0.45 * (1 - ph)})`;
          ctx.lineWidth = 1.4;
          ctx.arc(x, y, size + ph * 24, 0, Math.PI * 2);
          ctx.stroke();
        }
        // near labels for <3d — collected now, decluttered and drawn after
        if (hours < 72 && !it.ghost) {
          labels.push({
            x, y, size, right: x > cx, overdue,
            title: (it.title.length > 22 ? it.title.slice(0, 21) + '…' : it.title).toUpperCase(),
            delta: humanDelta(new Date(it.due_at!).getTime() - now.getTime()),
          });
        }
        // sweep contact ping
        const da = Math.abs((((angle - Math.PI / 2 - sweepRef.current) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
        if (da < 0.03 && t - lastPing.current > 3600 && !it.ghost) { lastPing.current = t; sfx.ping(); }
      }
      blipsRef.current = blips;

      // ── label declutter: greedy vertical push, per side ──
      const ROW = 21;
      for (const side of [true, false]) {
        const group = labels.filter(l => l.right === side).sort((a, b) => a.y - b.y);
        let lastY = -Infinity;
        for (const l of group) {
          let ly = l.y;
          if (ly - lastY < ROW) ly = lastY + ROW;
          lastY = ly;
          const lx = l.x + (side ? l.size + 7 : -l.size - 7);
          ctx.textAlign = side ? 'left' : 'right';
          // leader line when the label had to move
          if (Math.abs(ly - l.y) > 3) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(41,41,41,0.22)';
            ctx.lineWidth = 1;
            ctx.moveTo(l.x + (side ? l.size + 2 : -l.size - 2), l.y);
            ctx.lineTo(lx - (side ? 3 : -3), ly - 3);
            ctx.stroke();
          }
          ctx.lineWidth = 3.2; ctx.lineJoin = 'round';
          ctx.font = '600 9.5px Inter, sans-serif';
          ctx.strokeStyle = 'rgba(242,241,237,0.94)';
          ctx.strokeText(l.title, lx, ly - 3);
          ctx.fillStyle = l.overdue ? OVERDUE : INK;
          ctx.fillText(l.title, lx, ly - 3);
          ctx.font = '500 9px Inter, sans-serif';
          ctx.strokeStyle = 'rgba(242,241,237,0.94)';
          ctx.strokeText(l.delta, lx, ly + 8);
          ctx.fillStyle = l.overdue ? 'rgba(228,86,110,0.85)' : 'rgba(41,41,41,0.55)';
          ctx.fillText(l.delta, lx, ly + 8);
        }
      }
      ctx.lineWidth = 1;

      // center count
      ctx.textAlign = 'center';
      const overCount = blips.filter(b => b.overdue).length;
      if (overCount) {
        ctx.font = '700 10px Inter, sans-serif';
        ctx.lineWidth = 3; ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(242,241,237,0.94)';
        ctx.strokeText(`${overCount} OVERDUE`, cx, cy + R * 0.13 + 15);
        ctx.fillStyle = OVERDUE;
        ctx.fillText(`${overCount} OVERDUE`, cx, cy + R * 0.13 + 15);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active, classById, sectors, now]);

  const onMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = blipsRef.current.find(b => Math.hypot(b.x - mx, b.y - my) < Math.max(10, b.size + 5));
    setTip(hit ? { x: e.clientX, y: e.clientY, it: hit.it } : null);
  };
  const onClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = blipsRef.current.find(b => Math.hypot(b.x - mx, b.y - my) < Math.max(10, b.size + 5));
    if (hit) openDetail(hit.it.id);
  };

  const k = tip ? data.classes.find(c => c.id === tip.it.class_id) : null;

  return (
    <div ref={wrapRef} className="radar-wrap view-enter" style={{ height: 'calc(100vh - 130px)', minHeight: 520 }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', cursor: 'crosshair' }}
        onMouseMove={onMove}
        onMouseLeave={() => setTip(null)}
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
