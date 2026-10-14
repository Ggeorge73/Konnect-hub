'use client';
import { useState } from 'react';
import { Button, ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import GridOnOutlined from '@mui/icons-material/GridOnOutlined';

export type ExportParams = Record<string, string | number | undefined | null | string[]>;

/** The download URL of a list-view export (see app/api/exports/[entity]/route.ts). */
export function exportUrl(entity: string, format: 'csv' | 'xlsx', params: ExportParams = {}) {
  const sp = new URLSearchParams({ format });
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return `/api/exports/${entity}?${sp}`;
}

/**
 * "Export" button with CSV and Excel options (EXP-01). The server builds the file from the rows
 * the viewer may see, with the same filters, sort and columns as the view, and audits it.
 */
export function ExportMenu({
  entity,
  params,
  label = 'Export',
  size = 'small',
}: {
  entity: string;
  params?: ExportParams;
  label?: string;
  size?: 'small' | 'medium';
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const id = `export-${entity}`;
  return (
    <>
      <Button
        size={size}
        variant="outlined"
        startIcon={<FileDownloadOutlined />}
        aria-haspopup="menu"
        aria-controls={anchor ? `${id}-menu` : undefined}
        aria-expanded={anchor ? 'true' : undefined}
        id={`${id}-button`}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        {label}
      </Button>
      <Menu
        id={`${id}-menu`}
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        MenuListProps={{ 'aria-labelledby': `${id}-button` }}
      >
        <MenuItem
          component="a"
          href={exportUrl(entity, 'csv', params)}
          download
          onClick={() => setAnchor(null)}
        >
          <ListItemIcon>
            <DescriptionOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText>CSV</ListItemText>
        </MenuItem>
        <MenuItem
          component="a"
          href={exportUrl(entity, 'xlsx', params)}
          download
          onClick={() => setAnchor(null)}
        >
          <ListItemIcon>
            <GridOnOutlined fontSize="small" />
          </ListItemIcon>
          <ListItemText>Excel (.xlsx)</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
