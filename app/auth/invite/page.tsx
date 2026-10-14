import Link from 'next/link';
import { Alert, Stack, Typography } from '@mui/material';
import { COMPANY_NAME } from '@/lib/config';

export const metadata = { title: 'Invitation needed' };

/**
 * Shown when a Google or Microsoft sign-in has no invited Konnect Hub profile (KH-41). The
 * callback has already signed the session out; nothing was created for this email.
 */
export default function InvitePage() {
  return (
    <Stack spacing={2}>
      <Typography variant="h1" fontSize={24}>
        Ask your Konnector admin for an invite
      </Typography>
      <Alert severity="info">
        There is no Konnect Hub account for the email you signed in with. Accounts are created by invitation
        only, so ask your {COMPANY_NAME} admin or project lead to invite this email address.
      </Alert>
      <Typography fontSize={14} color="text.secondary">
        Already invited under a different address? Sign in with that email, or with the Google or Microsoft
        account that uses it.
      </Typography>
      <Link href="/auth/sign-in" style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>
        Back to sign in
      </Link>
    </Stack>
  );
}
