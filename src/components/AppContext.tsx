'use client';
// ── Global app state: data + optimistic mutations + clock + proposals ─────
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AppData, ClassComponent, Holiday, Item, Klass, Score, Semester, Settings, Source } from '@/lib/types';
import { getStore, uid, type Store } from '@/lib/store';
import { proposeGhosts, isOverdue, briefing } from '@/lib/planner';
import { setSound, sfx } from '@/lib/sound';

export type View = 'RADAR' | 'TODAY' | 'TABLE' | 'INTAKE' | 'PLAN' | 'CLASSES' | 'GRADES' | 'SETTINGS';

export interface Toast { id: string; msg: string; tone: 'ok' | 'warn' | 'danger'; }

interface Ctx {
  data: AppData;
  now: Date;
  view: View;
  setView: (v: View) => void;
  detailId: string | null;
  openDetail: (id: string | null) => void;
  toasts: Toast[];
  notify: (msg: string, tone?: Toast['tone']) => void;
  paletteOpen: boolean; setPaletteOpen: (b: boolean) => void;
  panicOpen: boolean; setPanicOpen: (b: boolean) => void;
  // mutations
  refresh: () => Promise<void>;
  addItem: (p: Partial<Item> & { title: string }) => Promise<Item>;
  updateItem: (id: string, p: Partial<Item>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  setStatus: (id: string, status: Item['status']) => Promise<void>;
  acceptGhost: (id: string) => Promise<void>;
  upsertSemester: (s: Omit<Semester, 'id'> & { id?: string }) => Promise<void>;
  insertHolidays: (hs: Array<{ date: string; name: string }>) => Promise<void>;
  deleteHoliday: (id: string) => Promise<void>;
  insertClass: (k: Omit<Klass, 'id' | 'created_at'>) => Promise<Klass>;
  updateClass: (id: string, p: Partial<Klass>) => Promise<void>;
  deleteClass: (id: string) => Promise<void>;
  insertComponent: (c: Omit<ClassComponent, 'id'>) => Promise<void>;
  updateComponent: (id: string, p: Partial<ClassComponent>) => Promise<void>;
  deleteComponent: (id: string) => Promise<void>;
  insertSource: (s: Omit<Source, 'id' | 'created_at'>) => Promise<Source>;
  insertItemsBatch: (items: Array<Partial<Item> & { title: string }>) => Promise<void>;
  insertScore: (s: Omit<Score, 'id'>) => Promise<void>;
  deleteScore: (id: string) => Promise<void>;
  saveSettings: (p: Partial<Settings>) => Promise<void>;
}

const AppCtx = createContext<Ctx | null>(null);
export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

function completeItem(p: Partial<Item> & { title: string }): Item {
  const now = new Date().toISOString();
  return {
    id: p.id ?? uid(), class_id: null, type: 'task', details: '', due_at: null, all_day: true,
    at_home: true, bucket: null, weight_pct: null, effort_min: 0, status: 'pending', ghost: false,
    parent_id: null, start_suggested_at: null, completed_at: null, source_id: null,
    created_at: now, updated_at: now, ...p, title: p.title,
  };
}

export function AppProvider({ initial, children }: { initial: AppData; children: React.ReactNode }) {
  const [data, setData] = useState<AppData>(initial);
  const [now, setNow] = useState(() => new Date());
  const [view, setViewRaw] = useState<View>('RADAR');
  const [detailId, openDetail] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [panicOpen, setPanicOpen] = useState(false);
  const storeRef = useRef<Store | null>(null);
  const proposedOnce = useRef(false);

  const store = useCallback(async (): Promise<Store> => {
    if (!storeRef.current) storeRef.current = await getStore();
    return storeRef.current;
  }, []);

  const notify = useCallback((msg: string, tone: Toast['tone'] = 'ok') => {
    const t = { id: uid(), msg, tone };
    setToasts(x => [...x.slice(-3), t]);
    setTimeout(() => setToasts(x => x.filter(y => y.id !== t.id)), 4200);
  }, []);

  const setView = useCallback((v: View) => {
    setViewRaw(v); sfx.tick();
  }, []);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { setSound(data.settings.sound_on); }, [data.settings.sound_on]);

  // tab-title status beacon
  useEffect(() => {
    const b = briefing(data, now);
    const over = data.items.filter(i => isOverdue(i, now)).length;
    const parts: string[] = [];
    if (over) parts.push(`${over} OVER`);
    if (b.dueToday.length) parts.push(`${b.dueToday.length} DUE`);
    document.title = parts.length ? `● ${parts.join(' · ')} — AcademAI` : 'AcademAI — ALL CLEAR';
  }, [data, now]);

  const refresh = useCallback(async () => {
    const s = await store();
    setData(await s.load());
  }, [store]);

  // Auto-propose ghosts once per session (study blocks + start dates)
  useEffect(() => {
    if (proposedOnce.current) return;
    proposedOnce.current = true;
    (async () => {
      try {
        const props = proposeGhosts(data, new Date());
        if (props.length === 0) return;
        const s = await store();
        const ghosts: Item[] = [];
        for (const p of props) {
          if (p.kind === 'study') ghosts.push(completeItem({ ...(p.item as Partial<Item> & { title: string }), ghost: true }));
          else if (p.kind === 'start') {
            const eff = p.forItem;
            const daysNeeded = Math.max(1, Math.ceil((eff.effort_min || 90) / 90));
            const startAt = new Date(new Date(eff.due_at!).getTime() - daysNeeded * 86400000).toISOString();
            await s.updateItem(eff.id, { start_suggested_at: startAt });
          }
        }
        if (ghosts.length) await s.insertItems(ghosts);
        await refresh();
        if (ghosts.length) { notify(`${ghosts.length} study block${ghosts.length > 1 ? 's' : ''} proposed — dashed blips on radar`, 'warn'); sfx.ghost(); }
      } catch { /* proposals are best-effort */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wrap = useCallback(async (fn: (s: Store) => Promise<void>, apply: (d: AppData) => AppData) => {
    setData(d => apply(structuredClone(d)));
    try { const s = await store(); await fn(s); }
    catch (e) { notify(`Save failed: ${(e as Error).message}`, 'danger'); await refresh(); }
  }, [store, notify, refresh]);

  const api: Ctx = useMemo(() => ({
    data, now, view, setView, detailId, openDetail, toasts, notify,
    paletteOpen, setPaletteOpen, panicOpen, setPanicOpen, refresh,
    addItem: async (p) => {
      const it = completeItem(p);
      await wrap(s => s.insertItems([it]), d => ({ ...d, items: [...d.items, it] }));
      return it;
    },
    updateItem: async (id, p) => wrap(s => s.updateItem(id, p),
      d => ({ ...d, items: d.items.map(i => i.id === id ? { ...i, ...p, updated_at: new Date().toISOString() } : i) })),
    deleteItem: async (id) => wrap(s => s.deleteItem(id),
      d => ({ ...d, items: d.items.filter(i => i.id !== id && i.parent_id !== id) })),
    setStatus: async (id, status) => {
      const patch: Partial<Item> = { status, completed_at: status === 'done' ? new Date().toISOString() : null };
      if (status === 'done') sfx.confirm(); if (status === 'missed') sfx.crash();
      return wrap(s => s.updateItem(id, patch),
        d => ({ ...d, items: d.items.map(i => i.id === id ? { ...i, ...patch } : i) }));
    },
    acceptGhost: async (id) => {
      sfx.confirm();
      return wrap(s => s.updateItem(id, { ghost: false }),
        d => ({ ...d, items: d.items.map(i => i.id === id ? { ...i, ghost: false } : i) }));
    },
    upsertSemester: async (sm) => {
      const full: Semester = { id: sm.id ?? data.semester?.id ?? uid(), name: sm.name, start_date: sm.start_date, end_date: sm.end_date };
      return wrap(s => s.upsertSemester(full), d => ({ ...d, semester: full }));
    },
    insertHolidays: async (hs) => {
      const semId = data.semester?.id; if (!semId) return;
      const full: Holiday[] = hs.map(h => ({ id: uid(), semester_id: semId, ...h }));
      return wrap(s => s.insertHolidays(full), d => ({ ...d, holidays: [...d.holidays, ...full] }));
    },
    deleteHoliday: async (id) => wrap(s => s.deleteHoliday(id), d => ({ ...d, holidays: d.holidays.filter(h => h.id !== id) })),
    insertClass: async (k) => {
      const full: Klass = { ...k, id: uid(), created_at: new Date().toISOString() };
      await wrap(s => s.insertClass(full), d => ({ ...d, classes: [...d.classes, full] }));
      return full;
    },
    updateClass: async (id, p) => wrap(s => s.updateClass(id, p),
      d => ({ ...d, classes: d.classes.map(c => c.id === id ? { ...c, ...p } : c) })),
    deleteClass: async (id) => wrap(s => s.deleteClass(id),
      d => ({ ...d, classes: d.classes.filter(c => c.id !== id), components: d.components.filter(c => c.class_id !== id), items: d.items.filter(i => i.class_id !== id) })),
    insertComponent: async (c) => {
      const full: ClassComponent = { ...c, id: uid() };
      return wrap(s => s.insertComponents([full]), d => ({ ...d, components: [...d.components, full] }));
    },
    updateComponent: async (id, p) => wrap(s => s.updateComponent(id, p),
      d => ({ ...d, components: d.components.map(c => c.id === id ? { ...c, ...p } : c) })),
    deleteComponent: async (id) => wrap(s => s.deleteComponent(id),
      d => ({ ...d, components: d.components.filter(c => c.id !== id) })),
    insertSource: async (src) => {
      const full: Source = { ...src, id: uid(), created_at: new Date().toISOString() };
      await wrap(s => s.insertSource(full), d => ({ ...d, sources: [full, ...d.sources] }));
      return full;
    },
    insertItemsBatch: async (items) => {
      const full = items.map(completeItem);
      return wrap(s => s.insertItems(full), d => ({ ...d, items: [...d.items, ...full] }));
    },
    insertScore: async (sc) => {
      const full: Score = { ...sc, id: uid() };
      return wrap(s => s.insertScore(full), d => ({ ...d, scores: [...d.scores, full] }));
    },
    deleteScore: async (id) => wrap(s => s.deleteScore(id), d => ({ ...d, scores: d.scores.filter(s2 => s2.id !== id) })),
    saveSettings: async (p) => wrap(s => s.saveSettings(p), d => ({ ...d, settings: { ...d.settings, ...p } })),
  }), [data, now, view, detailId, toasts, paletteOpen, panicOpen, wrap, refresh, notify, setView]);

  return <AppCtx.Provider value={api}>{children}</AppCtx.Provider>;
}
