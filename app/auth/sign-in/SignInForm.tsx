'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Button, Divider, Stack, TextField, Typography } from '@mui/material';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const REASONS: Record<string, string> = {
  expired: 'Your session has expired. Please sign in again.',
  'no-profile': 'This account has no Konnect Hub profile yet. Ask your Konnector admin to invite you.',
  'link-failed': 'That sign-in link is invalid or has expired. Request a new one.',
};

/** Email + password, or a one-time magic link (Supabase Auth). */
export function SignInForm({ configured, reason }: { configured: boolean; reason?: string }) {
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
      <Typography fontSize={12} color="text.secondary">
        Konnector staff will be asked for an authenticator code after signing in.
      </Typography>
    </Stack>
  );
}
