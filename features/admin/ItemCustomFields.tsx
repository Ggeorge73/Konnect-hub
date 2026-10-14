'use client';
import { useEffect, useId, useState } from 'react';
import { Alert, Box, MenuItem, Stack, TextField, Typography } from '@mui/material';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import { useMe } from '@/lib/client/api';
import { canEditItems } from '@/lib/domain/permissions';
import type { CustomField } from '@/lib/domain/admin';
import { useCustomFields, useItemFieldValues, useSetFieldValue } from './api';

/**
 * "Custom fields" section of the item side panel (ADM-01): the workspace fields the viewer may
 * see, editable by Konnector staff (saved on blur / change), read-only for clients.
 * Hidden when the workspace has no fields.
 */
export function ItemCustomFields({ itemKey, projectKey }: { itemKey: string; projectKey: string }) {
  const { data: me } = useMe();
  const { data: fields = [] } = useCustomFields();
  const { data: values } = useItemFieldValues(itemKey);
  const set = useSetFieldValue(itemKey, projectKey);
  const headingId = useId();
  if (!me || fields.length === 0) return null;
  const editable = canEditItems(me.user);
  return (
    <Box sx={{ mt: 2.5 }} component="section" aria-labelledby={headingId}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <TuneOutlined fontSize="small" aria-hidden />
        <Typography variant="subtitle2" id={headingId}>
          Custom fields
        </Typography>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
        {fields.map((f) => (
          <FieldInput
            key={f.id}
            field={f}
            value={values?.[f.id] ?? ''}
            editable={editable}
            onSave={(v) => set.mutate({ fieldId: f.id, value: v || null })}
          />
        ))}
      </Box>
      {set.error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {set.error.message}
        </Alert>
      )}
    </Box>
  );
}

function FieldInput({
  field,
  value,
  editable,
  onSave,
}: {
  field: CustomField;
  value: string;
  editable: boolean;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const common = {
    size: 'small' as const,
    fullWidth: true,
    label: field.name,
    value: draft,
    disabled: !editable,
    slotProps: { htmlInput: { 'data-testid': `field-${field.name}` }, inputLabel: { shrink: true } },
  };
  if (field.kind === 'select')
    return (
      <TextField
        {...common}
        select
        onChange={(e) => {
          setDraft(e.target.value);
          if (e.target.value !== value) onSave(e.target.value);
        }}
      >
        <MenuItem value="">
          <em>None</em>
        </MenuItem>
        {field.options.map((o) => (
          <MenuItem key={o} value={o}>
            {o}
          </MenuItem>
        ))}
      </TextField>
    );
  return (
    <TextField
      {...common}
      type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text'}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onSave(draft.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
