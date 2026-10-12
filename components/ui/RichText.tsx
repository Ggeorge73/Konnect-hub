'use client';
import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Box, IconButton, Stack, Tooltip } from '@mui/material';
import FormatBold from '@mui/icons-material/FormatBold';
import FormatItalic from '@mui/icons-material/FormatItalic';
import FormatListBulleted from '@mui/icons-material/FormatListBulleted';
import FormatListNumbered from '@mui/icons-material/FormatListNumbered';

/** Tiptap editor. Saves on blur so every keystroke isn't a request. */
export function RichText({
  value,
  onSave,
  editable = true,
  label,
}: {
  value: string;
  onSave: (html: string) => void;
  editable?: boolean;
  label: string;
}) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    editable,
    immediatelyRender: false,
    editorProps: { attributes: { 'aria-label': label, role: 'textbox', 'aria-multiline': 'true' } },
    onBlur: ({ editor: e }) => {
      const html = e.getHTML();
      if (html !== value) onSave(html);
    },
  });
  useEffect(() => {
    if (editor && !editor.isFocused && editor.getHTML() !== value)
      editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);
  if (!editor) return null;
  const btn = (title: string, Icon: typeof FormatBold, run: () => void, active: boolean) => (
    <Tooltip title={title}>
      <IconButton
        size="small"
        aria-label={title}
        aria-pressed={active}
        onMouseDown={(e) => e.preventDefault()}
        onClick={run}
        color={active ? 'primary' : 'default'}
      >
        <Icon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 3,
        '&:focus-within': { borderColor: 'secondary.main' },
      }}
    >
      {editable && (
        <Stack direction="row" sx={{ borderBottom: 1, borderColor: 'divider', px: 0.5 }}>
          {btn('Bold', FormatBold, () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
          {btn(
            'Italic',
            FormatItalic,
            () => editor.chain().focus().toggleItalic().run(),
            editor.isActive('italic'),
          )}
          {btn(
            'Bulleted list',
            FormatListBulleted,
            () => editor.chain().focus().toggleBulletList().run(),
            editor.isActive('bulletList'),
          )}
          {btn(
            'Numbered list',
            FormatListNumbered,
            () => editor.chain().focus().toggleOrderedList().run(),
            editor.isActive('orderedList'),
          )}
        </Stack>
      )}
      <Box sx={{ px: 1.5, '& .ProseMirror': { minHeight: 80, outline: 'none', py: 1 }, '& p': { my: 0.5 } }}>
        <EditorContent editor={editor} />
      </Box>
    </Box>
  );
}
