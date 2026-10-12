import { Box, Paper, Stack, Typography } from '@mui/material';
import { APP_NAME, COMPANY_NAME } from '@/lib/config';

/** Centered glass card for the sign-in and MFA pages (no app shell, no session needed). */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box component="main" id="main" sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Paper sx={{ width: '100%', maxWidth: 420, p: { xs: 3, sm: 4 }, borderRadius: 4 }}>
        <Stack spacing={3}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              aria-hidden
              sx={{
                width: 34,
                height: 34,
                borderRadius: 2,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800,
              }}
            >
              K
            </Box>
            <Box>
              <Typography fontWeight={700}>{APP_NAME}</Typography>
              <Typography fontSize={12} color="text.secondary">
                {COMPANY_NAME}
              </Typography>
            </Box>
          </Stack>
          {children}
        </Stack>
      </Paper>
    </Box>
  );
}
