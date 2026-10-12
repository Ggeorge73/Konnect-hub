'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type State =
  | { step: 'loading' }
  | { step: 'enroll'; factorId: string; qr: string; secret: string }
  | { step: 'verify'; factorId: string };

/**
 * TOTP for Konnector staff (required) and clients (optional). Enrolls an authenticator app on
 * first use, otherwise asks for the current code. Success upgrades the session to aal2.
 */
export function MfaForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ step: 'loading' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    const mfa = createSupabaseBrowserClient().auth.mfa;
    (async () => {
      const { data, error } = await mfa.listFactors();
      if (error) return setError(error.message);
      const verified = data.totp[0];
      if (verified) return setState({ step: 'verify', factorId: verified.id });
      // Drop half-finished enrollments so enroll() doesn't collide with them.
      for (const f of data.all.filter((x) => x.factor_type === 'totp' && x.status === 'unverified'))
        await mfa.unenroll({ factorId: f.id });
      const res = await mfa.enroll({ factorType: 'totp', friendlyName: 'Konnect Hub' });
      if (res.error) return setError(res.error.message);
      setState({
        step: 'enroll',
        factorId: res.data.id,
        qr: res.data.totp.qr_code,
        secret: res.data.totp.secret,
      });
    })();
  }, [configured]);

  if (!configured)
    return (
      <Alert severity="info">
        Demo mode: two-step verification needs Supabase Auth.{' '}
        <Link href="/" style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>
          Open the app
        </Link>
      </Alert>
    );

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.step === 'loading') return;
    setBusy(true);
    setError(null);
    const { error } = await createSupabaseBrowserClient().auth.mfa.challengeAndVerify({
      factorId: state.factorId,
      code: code.trim(),
    });
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    // The session is now aal2: record the enrolment on the profile (profiles.mfa_enabled).
    // Best effort: access already depends on aal2, not on this flag.
    await fetch('/api/session/mfa', { method: 'POST' }).catch(() => undefined);
    setBusy(false);
    router.replace('/');
    router.refresh();
  };

  return (
    <Stack component="form" spacing={2} onSubmit={verify} noValidate>
      <Typography variant="h1" fontSize={24}>
        Two-step verification
      </Typography>
      {error && (
        <Alert severity="error" role="alert">
          {error}
        </Alert>
      )}
      {state.step === 'loading' && !error && (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 3 }}>
          <CircularProgress aria-label="Loading" />
        </Box>
      )}
      {state.step === 'enroll' && (
        <>
          <Typography color="text.secondary">
            Scan this code with your authenticator app (1Password, Google Authenticator, Authy…), then enter
            the 6-digit code it shows.
          </Typography>
          <Box sx={{ bgcolor: '#fff', p: 1.5, borderRadius: 2, alignSelf: 'center' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URL SVG from Supabase */}
            <img src={state.qr} alt="Authenticator QR code" width={180} height={180} />
          </Box>
          <Typography fontSize={12} color="text.secondary">
            Can&apos;t scan? Enter this key:{' '}
            <Box component="span" sx={{ fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>
              {state.secret}
            </Box>
          </Typography>
        </>
      )}
      {state.step === 'verify' && (
        <Typography color="text.secondary">Enter the 6-digit code from your authenticator app.</Typography>
      )}
      {state.step !== 'loading' && (
        <>
          <TextField
            label="Authentication code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            slotProps={{ htmlInput: { pattern: '[0-9]{6}', 'aria-describedby': undefined } }}
          />
          <Button type="submit" variant="contained" disabled={busy || code.length !== 6}>
            Verify
          </Button>
        </>
      )}
    </Stack>
  );
}
