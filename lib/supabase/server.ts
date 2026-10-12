import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * Supabase client for Server Components, route handlers and server actions, bound to the
 * request cookies. Server Components can't write cookies; middleware.ts refreshes the session.
 */
export async function createSupabaseServerClient() {
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) jar.set(name, value, options);
          } catch {
            /* Called from a Server Component: middleware keeps the session fresh instead. */
          }
        },
      },
    },
  );
}
