/**
 * Google and Microsoft sign-in (KH-41 AUTH-01), through Supabase Auth's OAuth providers
 * `google` and `azure`. Pure helpers shared by the sign-in page and the /auth/callback route.
 *
 * Account linking: Konnect Hub never creates accounts from a social sign-in. A user gets in only
 * when a `profiles` row (created by an admin invite) exists for that sign-in, with the same email.
 * Supabase links a Google/Microsoft identity to the invited auth user automatically when the
 * provider reports the same verified email; with "Allow new users to sign up" turned off in the
 * Supabase dashboard an unknown email is refused before any auth user exists. The callback checks
 * again and sends anyone without a matching profile to /auth/invite, signed out.
 *
 * MFA is unchanged: an OAuth session starts at aal1, so internal roles still have to pass TOTP
 * (lib/supabase/policy.ts checkSessionPolicy) before any page loads.
 */

export const OAUTH_PROVIDERS = ['google', 'azure'] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const OAUTH_LABEL: Record<OAuthProvider, string> = {
  google: 'Continue with Google',
  azure: 'Continue with Microsoft',
};

/** OpenID Connect scopes requested from both providers. */
export const OAUTH_SCOPES = 'openid email profile';

/**
 * Providers to offer, from `AUTH_OAUTH_PROVIDERS` (comma-separated, e.g. `google`). Unset means
 * both; `none` hides the buttons. Unknown names are ignored.
 */
export function enabledOAuthProviders(value: string | undefined): OAuthProvider[] {
  if (value === undefined || value.trim() === '') return [...OAUTH_PROVIDERS];
  const wanted = value
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .map((v) => (v === 'microsoft' ? 'azure' : v));
  return OAUTH_PROVIDERS.filter((p) => wanted.includes(p));
}

/** Arguments for `supabase.auth.signInWithOAuth`. */
export function oauthSignIn(provider: OAuthProvider, origin: string) {
  return {
    provider,
    options: { redirectTo: `${origin}/auth/callback`, scopes: OAUTH_SCOPES },
  };
}

export type LinkDecision = 'ok' | 'no-invite';

/**
 * Whether a freshly signed-in auth user may enter: they need an invited profile with the same id
 * (Supabase linked the identity to the invited user) and the same email. Anything else, including
 * a provider that returned no email, is treated as "not invited".
 */
export function linkDecision(
  authUser: { id: string; email?: string | null },
  profile: { id: string; email: string } | null,
): LinkDecision {
  const email = authUser.email?.trim().toLowerCase();
  if (!profile || !email) return 'no-invite';
  if (profile.id !== authUser.id || profile.email.trim().toLowerCase() !== email) return 'no-invite';
  return 'ok';
}

/** Supabase redirects provider/sign-up refusals to the callback as `error` + `error_description`. */
export function callbackErrorReason(params: URLSearchParams): 'invite' | 'link-failed' | null {
  const error = params.get('error');
  const code = params.get('error_code');
  const description = params.get('error_description') ?? '';
  if (!error && !code) return null;
  return code === 'signup_disabled' || /sign ?ups? not allowed|signup/i.test(description)
    ? 'invite'
    : 'link-failed';
}
