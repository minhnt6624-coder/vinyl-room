import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from './errors';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('YOUR-PROJECT-REF'));

export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured ? url! : 'http://localhost:54321',
  isSupabaseConfigured ? anonKey! : 'not-configured',
  { auth: { persistSession: true, autoRefreshToken: true } },
);

/**
 * Every visitor gets an anonymous Supabase session, so the database can tell
 * browsers apart (and tell who the host is) without any sign-up.
 */
let sessionPromise: Promise<string> | null = null;
export function ensureSession(): Promise<string> {
  sessionPromise ??= (async () => {
    if (!isSupabaseConfigured) throw new AppError('VR_NOT_CONFIGURED');
    const { data } = await supabase.auth.getSession();
    if (data.session) return data.session.user.id;
    const res = await supabase.auth.signInAnonymously();
    if (res.error || !res.data.user) {
      throw new AppError('VR_AUTH_FAILED', res.error?.message);
    }
    return res.data.user.id;
  })().catch((e) => {
    sessionPromise = null;
    throw e;
  });
  return sessionPromise;
}

/** Calls a Postgres function and converts failures into AppError codes. */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  await ensureSession();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw AppError.from(error);
  return data as T;
}
