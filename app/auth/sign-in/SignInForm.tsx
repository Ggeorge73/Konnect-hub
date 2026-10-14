'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Button, Divider, Stack, TextField, Typography } from '@mui/material';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { OAUTH_LABEL, oauthSignIn, type OAuthProvider } from '@/lib/auth/oauth';

const REASONS: Record<string, string> = {
  expired: 'Your session has expired. Please sign in again.',
  'no-profile': 'This account has no Konnect Hub profile yet. Ask your Konnector admin to invite you.',
  'link-failed': 'That sign-in link is invalid or has expired. Request a new one.',
};

/** Brand marks for the provider buttons (decorative; the button text names the provider). */
function ProviderMark({ provider }: { provider: OAuthProvider }) {
  if (provider === 'google')
    return (
      <svg aria-hidden width="18" height="18" viewBox="0 0 48 48">
        <path
          fill="#FFC107"
          d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
        />
        <path
          fill="#FF3D00"
          d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
        />
        <path
          fill="#4CAF50"
          d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
        />
        <path
          fill="#1976D2"
          d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
        />
      </svg>
    );
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 21 21">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

/**
 * Email + password, a one-time magic link, or Google / Microsoft (Supabase Auth). Social sign-in
 * only works for invited users (see lib/auth/oauth.ts); the buttons never show in demo mode.
 */
export function SignInForm({
  configured,
  reason,
  providers = [],
}: {
  configured: boolean;
  reason?: string;
  providers?: OAuthProvider[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // An expired or profile-less session must not linger in the cookies.
  useEffect(() => {
    if (configured && (reason === 'expired' || reason === 'no-profile'))
      void createSupabaseBrowserClient().auth.signOut();
  }, [configured, reason]);

  if (!configured)
    return (
      <Alert severity="info">
        Demo mode: Supabase Auth is not configured, so there is nothing to sign in to. Switch personas from
        the user menu instead.{' '}
        <Link href="/" style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>
          Open the app
        </Link>
      </Alert>
    );

  const withPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createSupabaseBrowserClient().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setError(error.message);
    // The server sends internal users on to /auth/mfa and clients to /portal.
    router.replace('/');
    router.refresh();
  };

  const magicLink = async () => {
    if (!email) return setError('Enter your email address first.');
    setBusy(true);
    setError(null);
    const { error } = await createSupabaseBrowserClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: false },
    });
    setBusy(false);
    if (error) return setError(error.message);
    setSent(true);
  };

  const withProvider = async (provider: OAuthProvider) => {
    setBusy(true);
    setError(null);
    // Redirects the browser to Google / Microsoft; it comes back to /auth/callback.
    const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth(
      oauthSignIn(provider, window.location.origin),
    );
    if (error) {
      setBusy(false);
      setError(error.message);
    }
  };

  return (
    <Stack component="form" spacing={2} onSubmit={withPassword} noValidate>
      <Typography variant="h1" fontSize={24}>
        Sign in
      </Typography>
      {reason && REASONS[reason] && <Alert severity="warning">{REASONS[reason]}</Alert>}
      {error && (
        <Alert severity="error" role="alert">
          {error}
        </Alert>
      )}
      {sent && <Alert severity="success">Check your inbox for a sign-in link.</Alert>}
      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoFocus
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button type="submit" variant="contained" disabled={busy || !email || !password}>
        Sign in
      </Button>
      <Divider>or</Divider>
      <Button variant="outlined" onClick={magicLink} disabled={busy}>
        Email me a magic link
      </Button>
      {providers.map((p) => (
        <Button
          key={p}
          variant="outlined"
          color="inherit"
          onClick={() => withProvider(p)}
          disabled={busy}
          startIcon={<ProviderMark provider={p} />}
        >
          {OAUTH_LABEL[p]}
        </Button>
      ))}
      <Typography fontSize={12} color="text.secondary">
        Konnector staff will be asked for an authenticator code after signing in.
      </Typography>
    </Stack>
  );
}
