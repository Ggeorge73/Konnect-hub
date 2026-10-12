'use client';
import { useId, useState } from 'react';
import { Box, Button, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import TableChartOutlined from '@mui/icons-material/TableChartOutlined';
import { MONO } from '@/lib/theme';

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

/**
 * Accessible data-table alternative for a chart. Always in the DOM for screen readers
 * (visually hidden), with a toggle that shows it to sighted users.
 */
export function ChartTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <Box className="kh-no-print">
      <Button
        size="small"
        startIcon={<TableChartOutlined />}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        sx={{ mt: 1 }}
      >
        {open ? 'Hide data table' : 'Show data table'}
      </Button>
      <Box id={id} sx={open ? { maxHeight: 260, overflow: 'auto', mt: 1 } : visuallyHidden}>
        <Table size="small">
          <caption style={{ captionSide: 'top', textAlign: 'left', padding: 0 }}>
            <Box component="span" sx={visuallyHidden}>
              {caption}
            </Box>
          </caption>
          <TableHead>
            <TableRow>
              {columns.map((c) => (
                <TableCell key={c} scope="col">
                  {c}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                {r.map((v, j) => (
                  <TableCell key={j} sx={j > 0 ? { fontFamily: MONO } : undefined}>
                    {v}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
}
