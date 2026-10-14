'use client';
import { useId, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Link,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import AttachFileOutlined from '@mui/icons-material/AttachFileOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import { useMe, usePeople } from '@/lib/client/api';
import { isClientRole } from '@/lib/domain/permissions';
import {
  ACCEPT_ATTR,
  canDeleteAttachment,
  canUpload,
  formatBytes,
  MAX_FILE_BYTES,
  uploadError,
  type Attachment,
  type AttachmentParent,
} from '@/lib/domain/files';
import type { Visibility } from '@/lib/domain/types';
import { Mono, VisibilityChip } from '@/components/ui/bits';
import { downloadUrl, useAttachments, useDeleteAttachment, useUpload } from './api';

const HINT = `Up to ${formatBytes(MAX_FILE_BYTES)}: PDF, images, text, CSV or Office files.`;

/**
 * Attachments section (FILE-01) for the item side panel and RAID entries: the files the viewer may
 * see, an upload button (with Internal / Shared for Konnector staff; client uploads are always
 * shared) and delete for the uploader or an Admin. Downloads go through the authorised route.
 * Files on comments are listed under their comment (CommentFiles), not here.
 */
export function Attachments({
  type,
  id,
  label = 'Attachments',
}: {
  type: AttachmentParent;
  id: string;
  label?: string;
}) {
  const { data: me } = useMe();
  const { data: files = [], error } = useAttachments(type, id, Boolean(me));
  const upload = useUpload({ type, id });
  const headingId = useId();
  const client = me ? isClientRole(me.user.role) : false;
  const [visibility, setVisibility] = useState<Visibility>('internal');
  if (!me) return null;
  const own = files.filter((f) => !f.commentId);

  return (
    <Box sx={{ mt: 2.5 }} component="section" aria-labelledby={headingId}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <AttachFileOutlined fontSize="small" aria-hidden />
        <Typography variant="subtitle2" id={headingId}>
          {label} ({own.length})
        </Typography>
      </Stack>
      {error && <Alert severity="error">{error.message}</Alert>}
      {own.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No files yet.
        </Typography>
      ) : (
        <FileList files={own} parent={{ type, id }} />
      )}
      {canUpload(me.user) && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, flexWrap: 'wrap', rowGap: 1 }}>
          {!client && (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={visibility}
              onChange={(_, v) => v && setVisibility(v)}
              aria-label="New file visibility"
            >
              <ToggleButton value="internal">
                <LockOutlined sx={{ fontSize: 16, mr: 0.5 }} aria-hidden />
                Internal
              </ToggleButton>
              <ToggleButton value="shared">
                <PublicOutlined sx={{ fontSize: 16, mr: 0.5 }} aria-hidden />
                Shared
              </ToggleButton>
            </ToggleButtonGroup>
          )}
          <UploadButton
            label="Attach file"
            busy={upload.isPending}
            onFile={(file) =>
              upload.mutate({ file, target: type, targetId: id, visibility: client ? 'shared' : visibility })
            }
          />
          <Typography variant="caption" color="text.secondary">
            {client ? `Shared with Konnector. ${HINT}` : HINT}
          </Typography>
        </Stack>
      )}
      {upload.error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {upload.error.message}
        </Alert>
      )}
    </Box>
  );
}

/** The files on one comment, with a small attach button. Shares the item's attachment query. */
export function CommentFiles({
  itemId,
  commentId,
  commentVisibility,
}: {
  itemId: string;
  commentId: string;
  commentVisibility: Visibility;
}) {
  const { data: me } = useMe();
  const { data: files = [] } = useAttachments('work_item', itemId, Boolean(me));
  const upload = useUpload({ type: 'work_item', id: itemId });
  const mine = files.filter((f) => f.commentId === commentId);
  if (!me) return null;
  return (
    <Box sx={{ mt: 0.5 }}>
      {mine.length > 0 && <FileList files={mine} parent={{ type: 'work_item', id: itemId }} dense />}
      {canUpload(me.user) && (
        <UploadButton
          label="Attach to comment"
          compact
          busy={upload.isPending}
          onFile={(file) =>
            upload.mutate({ file, target: 'comment', targetId: commentId, visibility: commentVisibility })
          }
        />
      )}
      {upload.error && (
        <Alert severity="error" sx={{ mt: 0.5 }}>
          {upload.error.message}
        </Alert>
      )}
    </Box>
  );
}

function FileList({
  files,
  parent,
  dense = false,
}: {
  files: Attachment[];
  parent: { type: AttachmentParent; id: string };
  dense?: boolean;
}) {
  const { data: me } = useMe();
  const { data: people = [] } = usePeople();
  const remove = useDeleteAttachment(parent);
  return (
    <Stack component="ul" spacing={dense ? 0.25 : 0.75} sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {files.map((f) => (
        <Stack
          component="li"
          key={f.id}
          direction="row"
          spacing={1}
          alignItems="center"
          data-testid={`attachment-${f.fileName}`}
        >
          <InsertDriveFileOutlined fontSize="small" color="primary" aria-hidden />
          <Link
            href={downloadUrl(f.id)}
            underline="hover"
            sx={{ fontSize: dense ? 13 : 14, wordBreak: 'break-all' }}
          >
            {f.fileName}
          </Link>
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            <Mono>{formatBytes(f.sizeBytes)}</Mono>
            {!dense && ` · ${people.find((p) => p.id === f.uploadedBy)?.name ?? 'Unknown'}`}
          </Typography>
          <VisibilityChip visibility={f.visibility} />
          <Box sx={{ flex: 1 }} />
          {me && canDeleteAttachment(me.user, f) && (
            <Tooltip title="Delete file">
              <IconButton
                size="small"
                aria-label={`Delete ${f.fileName}`}
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Delete ${f.fileName}? This can't be undone.`)) remove.mutate(f.id);
                }}
              >
                <DeleteOutline fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      ))}
    </Stack>
  );
}

function UploadButton({
  label,
  onFile,
  busy,
  compact = false,
}: {
  label: string;
  onFile: (f: File) => void;
  busy: boolean;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        accept={ACCEPT_ATTR}
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          const err = uploadError({ name: f.name, size: f.size, type: f.type });
          setError(err);
          if (!err) onFile(f);
        }}
      />
      <Button
        size="small"
        variant={compact ? 'text' : 'outlined'}
        startIcon={<AttachFileOutlined />}
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Uploading…' : label}
      </Button>
      {error && (
        <Typography variant="caption" color="error" role="alert">
          {error}
        </Typography>
      )}
    </>
  );
}
