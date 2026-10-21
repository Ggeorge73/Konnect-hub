'use client';
import { useQuery } from '@tanstack/react-query';
import { Box, Chip, Divider, List, ListItem, ListItemText, Paper, Stack, Typography } from '@mui/material';
import Grid from '@mui/material/Grid2';
import HandshakeOutlined from '@mui/icons-material/HandshakeOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import { api } from '@/lib/client/api';
import { Mono } from '@/components/ui/bits';
import { useProjectBundle } from '@/features/projects/ProjectFrame';
import {
  CLIENT_ITEM_STATUS_LABEL,
  CLIENT_ITEM_TYPE_LABEL,
  formatAmount,
  type ClientItem,
  type CrmProjectLink,
} from '@/lib/domain/crm';
import { statusColor, statusVariant } from '@/features/portal/ForYourReview';

interface Commercial {
  link: CrmProjectLink | null;
  items: ClientItem[];
}

/**
 * Project Overview → "From Konnector CRM": the handoff (contract, scope, acceptance headlines,
 * documents, extensions) and the commercial items the client was sent. Read-only: the CRM owns
 * them. Hidden when the project did not come from the CRM and has no items, and for associates.
 */
export function CommercialCard() {
  const { project } = useProjectBundle();
  const q = useQuery({
    queryKey: ['projects', project.key, 'commercial'],
    queryFn: () => api<Commercial>(`/api/projects/${project.key}/commercial`),
    retry: false,
  });
  if (!q.data || (!q.data.link && q.data.items.length === 0)) return null;
  const { link, items } = q.data;
  return (
    <Paper
      component="section"
      aria-labelledby="crm-heading"
      sx={{ p: 2.5, borderRadius: 4, mt: 2 }}
      data-testid="crm-commercial"
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <HandshakeOutlined color="primary" aria-hidden />
        <Typography variant="h3" component="h2" id="crm-heading" sx={{ flex: 1 }}>
          From Konnector CRM
        </Typography>
        <Chip size="small" icon={<LockOutlined />} label="Internal · read-only" variant="outlined" />
      </Stack>
      {link && (
        <Grid container spacing={2} sx={{ mt: 1 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="body2" color="text.secondary">
              Contract <Mono>{link.contractNo || '—'}</Mono> · value{' '}
              <Mono>{formatAmount(link.value, link.currency)}</Mono>
            </Typography>
            <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{link.scopeSummary}</Typography>
            {link.serviceLines.length > 0 && (
              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                {link.serviceLines.map((s) => (
                  <Chip key={s} size="small" label={s} />
                ))}
              </Stack>
            )}
            {link.documents.length > 0 && (
              <Box sx={{ mt: 1 }}>
                {link.documents.map((d) => (
                  <Typography key={d.url} variant="body2">
                    <a href={d.url} target="_blank" rel="noopener noreferrer">
                      {d.name}
                    </a>
                  </Typography>
                ))}
              </Box>
            )}
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="subtitle2">Acceptance criteria (headlines)</Typography>
            <List dense disablePadding>
              {link.acceptanceCriteria.map((c) => (
                <ListItem key={c} disableGutters>
                  <ListItemText primary={c} />
                </ListItem>
              ))}
            </List>
            {link.changes.length > 0 && (
              <>
                <Typography variant="subtitle2" sx={{ mt: 1 }}>
                  Changes from the CRM
                </Typography>
                <List dense disablePadding>
                  {link.changes.map((c, n) => (
                    <ListItem key={n} disableGutters>
                      <ListItemText
                        primary={c.reason}
                        secondary={[
                          c.newEndDate ? `End ${c.previousEndDate} → ${c.newEndDate}` : null,
                          c.additionalValue ? `+${formatAmount(c.additionalValue, c.currency)}` : null,
                          c.at.slice(0, 10),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      />
                    </ListItem>
                  ))}
                </List>
              </>
            )}
          </Grid>
        </Grid>
      )}
      {items.length > 0 && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2">Sent to the client</Typography>
          <List dense disablePadding>
            {items.map((i) => (
              <ListItem
                key={i.id}
                disableGutters
                secondaryAction={
                  <Chip
                    size="small"
                    label={CLIENT_ITEM_STATUS_LABEL[i.status]}
                    color={statusColor(i.status)}
                    variant={statusVariant(i.status)}
                  />
                }
              >
                <ListItemText
                  primary={`${CLIENT_ITEM_TYPE_LABEL[i.type]} · ${i.title} (v${i.version})`}
                  secondary={[
                    i.amount !== null ? formatAmount(i.amount, i.currency) : null,
                    i.decidedByName
                      ? `${i.decidedByName}${i.decidedByTitle ? `, ${i.decidedByTitle}` : ''}`
                      : null,
                    i.surveyScore !== null ? `score ${i.surveyScore}/10` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              </ListItem>
            ))}
          </List>
        </>
      )}
    </Paper>
  );
}
