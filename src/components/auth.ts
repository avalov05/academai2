'use client';
// Auth helpers (no-ops in demo mode)
import { IS_DEMO } from '@/lib/store';

export async function supaAccessToken(): Promise<string | null> {
  if (IS_DEMO) return null;
  const { supa } = await import('@/lib/store/supabase');
  const { data } = await supa().auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signOut(): Promise<void> {
  if (IS_DEMO) return;
  const { supa } = await import('@/lib/store/supabase');
  await supa().auth.signOut();
  location.href = '/login';
}
