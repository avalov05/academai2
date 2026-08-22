// ── Server-side: load one user's whole world with the service role ───────
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppData, Settings } from '../types';

export async function loadUserData(admin: SupabaseClient, uid: string, settings: Settings): Promise<AppData> {
  const [sem, hol, cls, cmp, itm] = await Promise.all([
    admin.from('semesters').select('*').eq('user_id', uid).order('start_date', { ascending: false }).limit(1),
    admin.from('holidays').select('*').eq('user_id', uid),
    admin.from('classes').select('*').eq('user_id', uid),
    admin.from('components').select('*').eq('user_id', uid),
    admin.from('items').select('*').eq('user_id', uid).eq('status', 'pending'),
  ]);
  return {
    semester: sem.data?.[0] ?? null,
    holidays: hol.data ?? [],
    classes: cls.data ?? [],
    components: cmp.data ?? [],
    items: itm.data ?? [],
    sources: [], scores: [],
    settings,
  };
}
