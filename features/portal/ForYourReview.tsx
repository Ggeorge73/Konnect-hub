'use client';
import Link from 'next/link';
import { Box, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import RequestQuoteOutlined from '@mui/icons-material/RequestQuoteOutlined';
import HistoryEduOutlined from '@mui/icons-material/HistoryEduOutlined';
import AutorenewOutlined from '@mui/icons-material/AutorenewOutlined';
import PollOutlined from '@mui/icons-material/PollOutlined';
import { EmptyState, Mono } from '@/components/ui/bits';
import {
  CLIENT_ITEM_STATUS_LABEL,
  CLIENT_ITEM_TYPE_LABEL,
  formatAmount,
  isOpenItem,
  isPastRespondBy,
  type ClientItem,
} from '@/lib/domain/crm';
import type { ClientItemType } from '@/lib/integration/contract';

export const ITEM_ICON: Record<ClientItemType, typeof RequestQuoteOutlined> = {
  quote: RequestQuoteOutlined,
  contract_amendment: HistoryEduOutlined,
  renewal_offer: AutorenewOutlined,
  survey: PollOutlined,
};

/** Open items are a filled teal chip; decided ones are outlined (AA contrast in both themes). */
export const statusVariant = (s: ClientItem['status']) => (isOpenItem({ status: s }) ? 'filled' : 'outlined');

export const statusColor = (s: ClientItem['status']) =>
  s === 'accepted'
    ? 'success'
    : s === 'declined'
      ? 'error'
      : s === 'changes_requested'
        ? 'warning'
        : isOpenItem({ status: s })
          ? 'primary'
          : 'default';

/**
 * "For your review": quotes, contract amendments, renewal offers and surveys Konnector published
 * from the CRM. Open items first with a badge count; decided ones stay listed for the record.
 */
export function ForYourReview({
  items,
  projectNames = {},
  id = 'review',
}: {
  items: ClientItem[];
  /** Project id → name, to label items on the portal home. */
  projectNames?: Record<string, string>;
  id?: string;
}) {
  const open = items.filter(isOpenItem);
  const rest = items.filter((i) => !isOpenItem(i));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Paper
      id={id}
      component="section"
      aria-labelledby={`${id}-title`}
      sx={{ borderRadius: 4, p: { xs: 2, sm: 2.5 }, scrollMarginTop: 120 }}
      data-testid="for-your-review"
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <RequestQuoteOutlined color="primary" aria-hidden />
        <Typography variant="h2" id={`${id}-title`} sx={{ flex: 1 }}>
          For your review
        </Typography>
        <Chip
          label={`${open.length} waiting`}
          color={open.length ? 'primary' : 'default'}
          size="small"
          sx={{ fontWeight: 700 }}
          data-testid="review-count"
        />
      </Stack>
      {items.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          body="Quotes, contract amendments, renewal offers and surveys from Konnector appear here when they need your decision."
        />
      ) : (
        <Stack
          component="ul"
          divider={<Divider component="li" aria-hidden sx={{ listStyle: 'none' }} />}
          sx={{ m: 0, p: 0 }}
        >
          {[...open, ...rest].map((i) => {
            const Icon = ITEM_ICON[i.type];
            const late = isOpenItem(i) && isPastRespondBy(i, today);
            return (
              <Stack
                key={i.id}
                component="li"
                direction={{ xs: 'column', sm: 'row' }}
                spacing={{ xs: 0.5, sm: 2 }}
                alignItems={{ sm: 'center' }}
                sx={{ py: 1.5, listStyle: 'none' }}
                data-testid={`review-item-${i.id}`}
              >
                <Stack direction="row" spacing={1.5} sx={{ flex: 1, minWidth: 0 }}>
                  <Icon color={isOpenItem(i) ? 'primary' : 'action'} sx={{ mt: 0.25 }} aria-hidden />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                      <Link href={`/portal/review/${encodeURIComponent(i.id)}`} style={{ color: 'inherit' }}>
                        {CLIENT_ITEM_TYPE_LABEL[i.type]} · {i.title}
                      </Link>
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                      {[
                        i.projectId ? projectNames[i.projectId] : null,
                        i.version > 1
                          ? `Version ${i.version} (supersedes v${i.supersedesVersion ?? i.version - 1})`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      {i.respondBy && isOpenItem(i) && (
                        <>
                          {' · '}
                          {late ? 'was due' : 'respond by'} <Mono>{i.respondBy}</Mono>
                        </>
                      )}
                    </Typography>
                  </Box>
                </Stack>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ pl: { xs: 4.5, sm: 0 }, flexShrink: 0 }}
                >
                  {i.amount !== null && <Mono>{formatAmount(i.amount, i.currency)}</Mono>}
                  <Chip
                    size="small"
                    label={CLIENT_ITEM_STATUS_LABEL[i.status]}
                    color={statusColor(i.status)}
                    variant={statusVariant(i.status)}
                  />
                </Stack>
              </Stack>
            );
          })}
        </Stack>
      )}
    </Paper>
  );
}
