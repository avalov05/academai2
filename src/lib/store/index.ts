// ── Persistence layer: swap demo (in-memory) ↔ supabase ──────────────────
import type { AppData, ClassComponent, Holiday, Item, Klass, Score, Semester, Settings, Source } from '../types';

export interface Store {
  load(): Promise<AppData>;
  upsertSemester(s: Semester): Promise<void>;
  insertHolidays(hs: Holiday[]): Promise<void>;
  deleteHoliday(id: string): Promise<void>;
  insertClass(k: Klass): Promise<void>;
  updateClass(id: string, patch: Partial<Klass>): Promise<void>;
  deleteClass(id: string): Promise<void>;
  insertComponents(cs: ClassComponent[]): Promise<void>;
  updateComponent(id: string, patch: Partial<ClassComponent>): Promise<void>;
  deleteComponent(id: string): Promise<void>;
  insertItems(its: Item[]): Promise<void>;
  updateItem(id: string, patch: Partial<Item>): Promise<void>;
  deleteItem(id: string): Promise<void>;
  insertSource(s: Source): Promise<void>;
  insertScore(s: Score): Promise<void>;
  deleteScore(id: string): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
}

export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

export function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

let _store: Store | null = null;
export async function getStore(): Promise<Store> {
  if (_store) return _store;
  if (IS_DEMO) {
    const { DemoStore } = await import('./demo');
    _store = new DemoStore();
  } else {
    const { SupabaseStore } = await import('./supabase');
    _store = new SupabaseStore();
  }
  return _store;
}
