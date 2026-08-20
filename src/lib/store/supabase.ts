// ── Supabase-backed store (RLS-scoped to the signed-in user) ─────────────
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AppData, ClassComponent, Holiday, Item, Klass, Score, Semester, Settings, Source } from '../types';
import type { Store } from './index';

let client: SupabaseClient | null = null;
export function supa(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: true, autoRefreshToken: true } },
    );
  }
  return client;
}

const DEFAULT_SETTINGS: Settings = {
  gemini_key: '', gemini_model: 'gemini-3.7-flash', ics_token: '',
  sound_on: true, free_min_weekday: 240, free_min_weekend: 420,
};

async function userId(): Promise<string> {
  const { data } = await supa().auth.getUser();
  if (!data.user) throw new Error('Not signed in');
  return data.user.id;
}

function bail(e: { message: string } | null) { if (e) throw new Error(e.message); }

export class SupabaseStore implements Store {
  async load(): Promise<AppData> {
    const s = supa();
    const [sem, hol, cls, cmp, itm, src, sco, set] = await Promise.all([
      s.from('semesters').select('*').order('start_date', { ascending: false }).limit(1),
      s.from('holidays').select('*'),
      s.from('classes').select('*').order('created_at'),
      s.from('components').select('*'),
      s.from('items').select('*'),
      s.from('sources').select('*').order('created_at', { ascending: false }).limit(50),
      s.from('scores').select('*'),
      s.from('user_settings').select('*').maybeSingle(),
    ]);
    for (const r of [sem, hol, cls, cmp, itm, src, sco]) bail(r.error);
    let settings: Settings;
    if (set.data) {
      settings = { ...DEFAULT_SETTINGS, ...strip(set.data) };
    } else {
      const uidv = await userId();
      const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
      settings = { ...DEFAULT_SETTINGS, ics_token: token };
      const ins = await s.from('user_settings').insert({ user_id: uidv, ...settings });
      bail(ins.error);
    }
    return {
      semester: (sem.data?.[0] as Semester | undefined) ?? null,
      holidays: (hol.data ?? []) as Holiday[],
      classes: (cls.data ?? []) as Klass[],
      components: (cmp.data ?? []) as ClassComponent[],
      items: (itm.data ?? []) as Item[],
      sources: (src.data ?? []) as Source[],
      scores: (sco.data ?? []) as Score[],
      settings,
    };
  }
  private async ins(table: string, rows: object[]) {
    if (rows.length === 0) return;
    const uidv = await userId();
    const { error } = await supa().from(table).insert(rows.map(r => ({ ...r, user_id: uidv })));
    bail(error);
  }
  private async upd(table: string, id: string, patch: object) {
    const { error } = await supa().from(table).update(patch).eq('id', id);
    bail(error);
  }
  private async del(table: string, id: string) {
    const { error } = await supa().from(table).delete().eq('id', id);
    bail(error);
  }
  async upsertSemester(sm: Semester) {
    const uidv = await userId();
    const { error } = await supa().from('semesters').upsert({ ...sm, user_id: uidv });
    bail(error);
  }
  async insertHolidays(hs: Holiday[]) { await this.ins('holidays', hs); }
  async deleteHoliday(id: string) { await this.del('holidays', id); }
  async insertClass(k: Klass) { await this.ins('classes', [k]); }
  async updateClass(id: string, p: Partial<Klass>) { await this.upd('classes', id, p); }
  async deleteClass(id: string) { await this.del('classes', id); }
  async insertComponents(cs: ClassComponent[]) { await this.ins('components', cs); }
  async updateComponent(id: string, p: Partial<ClassComponent>) { await this.upd('components', id, p); }
  async deleteComponent(id: string) { await this.del('components', id); }
  async insertItems(its: Item[]) { await this.ins('items', its); }
  async updateItem(id: string, p: Partial<Item>) { await this.upd('items', id, { ...p, updated_at: new Date().toISOString() }); }
  async deleteItem(id: string) { await this.del('items', id); }
  async insertSource(s: Source) { await this.ins('sources', [s]); }
  async insertScore(s: Score) { await this.ins('scores', [s]); }
  async deleteScore(id: string) { await this.del('scores', id); }
  async saveSettings(p: Partial<Settings>) {
    const uidv = await userId();
    const { error } = await supa().from('user_settings').update(p).eq('user_id', uidv);
    bail(error);
  }
}

function strip(row: Record<string, unknown>): Partial<Settings> {
  const { gemini_key, gemini_model, ics_token, sound_on, free_min_weekday, free_min_weekend } = row as Record<string, never>;
  return { gemini_key, gemini_model, ics_token, sound_on, free_min_weekday, free_min_weekend };
}
