import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { resetOnboarding } from '@/lib/data/onboarding';
import { isPostgresEnabled } from '@/lib/data';
import { isSupabaseConfigured } from '@/lib/config';

/**
 * Demo-mode test hook: marks the workspace as not onboarded so the first-run wizard shows again.
 * 404 outside demo mode (Supabase Auth or Postgres); there, Admins re-run setup from /admin.
 */
export async function POST() {
  if (isSupabaseConfigured() || isPostgresEnabled())
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  return handle(({ session }) => resetOnboarding(session));
}
