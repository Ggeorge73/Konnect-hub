import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Refreshes the Supabase session cookies on every request (Server Components can't write
 * cookies). Access rules are enforced in lib/session.ts and by RLS, not here.
 */
export async function updateSession(request: NextRequest, headers: Headers = request.headers) {
  // `headers` are the request headers passed on to the app (middleware.ts adds the CSP nonce).
  const next = () => NextResponse.next({ request: { headers } });
  let response = next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          headers.set('cookie', request.cookies.toString());
          response = next();
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    },
  );
  // Validates the token and refreshes it if needed; writes new cookies via setAll.
  await supabase.auth.getClaims();
  return response;
}
