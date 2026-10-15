'use client';
import { useEffect, useState } from 'react';
import { Box, Button } from '@mui/material';

export const PORTAL_SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'review', label: 'For your review' },
  { id: 'work', label: 'Work' },
  { id: 'reports', label: 'Status reports' },
  { id: 'raid', label: 'Risks and issues' },
  { id: 'milestones', label: 'Milestones' },
] as const;

/**
 * Sticky anchor navigation for the portal project page. Every section stays on one page (good
 * for printing and deep links such as #deliverables); the nav highlights the section in view.
 */
export function PortalSectionNav() {
  const [active, setActive] = useState<string>('overview');
  useEffect(() => {
    const els = PORTAL_SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    if (!('IntersectionObserver' in window) || els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: '-120px 0px -60% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <Box
      component="nav"
      aria-label="Project sections"
      className="kh-no-print"
      sx={{
        position: 'sticky',
        top: { xs: 56, sm: 64 },
        zIndex: 2,
        mx: { xs: -2, sm: 0 },
        px: { xs: 2, sm: 1 },
        py: 1,
        bgcolor: 'background.default',
        borderBottom: 1,
        borderColor: 'divider',
        overflowX: 'auto',
        maxWidth: { xs: '100vw', sm: 'none' },
      }}
    >
      <Box
        component="ul"
        sx={{ display: 'flex', gap: 0.5, m: 0, p: 0, listStyle: 'none', width: 'max-content' }}
      >
        {PORTAL_SECTIONS.map((s) => (
          <li key={s.id}>
            <Button
              href={`#${s.id}`}
              size="small"
              variant={active === s.id ? 'contained' : 'text'}
              color={active === s.id ? 'primary' : 'inherit'}
              aria-current={active === s.id ? 'true' : undefined}
              onClick={() => setActive(s.id)}
              sx={{ whiteSpace: 'nowrap', borderRadius: 2 }}
            >
              {s.label}
            </Button>
          </li>
        ))}
      </Box>
    </Box>
  );
}
