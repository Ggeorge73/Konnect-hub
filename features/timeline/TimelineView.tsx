'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useProjectBundle } from '@/features/projects/ProjectFrame';
import type { TimelineData } from '@/lib/data/sprints';
import { RAG_COLORS } from '@/lib/theme';
import { ITEM_TYPES } from '@/lib/domain/workflow';
import {
  AXIS_H,
  BAR_H,
  HEADER_H,
  MILESTONE_ROW_H,
  PHASE_ROW_H,
  ROW_H,
  ZOOMS,
  barAriaLabel,
  buildTimeline,
  dragDays,
  formatDate,
  noCriticalPath,
  shiftSpan,
  type Bar,
  type CriticalPathFn,
  type TimelineInput,
  type Zoom,
} from './layout';
import { useReschedule, useTimeline } from './api';

const LABEL_W = 240;
const SPRINT_COLOR = '#3B82F6';
const EPIC_COLOR = ITEM_TYPES.find((t) => t.id === 'epic')!.color;
const srOnly = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

const todayIso = () => new Date().toISOString().slice(0, 10);

export function TimelineView({ criticalPath }: { criticalPath?: CriticalPathFn }) {
  const b = useProjectBundle();
  const { data, isLoading, error } = useTimeline(b.project.key);
  const reschedule = useReschedule(b.project.key);
  const [zoom, setZoom] = useState<Zoom>('month');
  const [msg, setMsg] = useState<string | null>(null);

  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (isLoading || !data) return <Skeleton variant="rounded" height={360} />;

  return (
    <Paper sx={{ borderRadius: 4, p: 2 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="h2" component="h2">
          Timeline
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Legend />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={zoom}
          onChange={(_, v) => v && setZoom(v)}
          aria-label="Zoom"
        >
          {ZOOMS.map((z) => (
            <ToggleButton key={z.id} value={z.id} aria-label={`Zoom to ${z.label.toLowerCase()}`}>
              {z.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>
      {data.canEdit && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }} id="timeline-help">
          Drag a sprint or epic bar sideways to reschedule it, or focus a bar and use the Left and Right arrow
          keys to move it a day at a time.
        </Typography>
      )}
      <Timeline
        data={data}
        zoom={zoom}
        today={todayIso()}
        criticalPath={criticalPath}
        onReschedule={(bar, days) => {
          const span = shiftSpan(bar, days);
          reschedule.mutate(
            { kind: bar.kind, id: bar.id, startDate: span.start, endDate: span.end },
            {
              onSuccess: () =>
                setMsg(`${bar.label} moved to ${formatDate(span.start)} – ${formatDate(span.end)}.`),
              onError: (e) => setMsg(e.message),
            },
          );
        }}
      />
      <Box role="status" aria-live="polite" sx={srOnly}>
        {msg}
      </Box>
      <Snackbar open={Boolean(reschedule.error)} autoHideDuration={6000} onClose={() => reschedule.reset()}>
        <Alert severity="error" onClose={() => reschedule.reset()}>
          {reschedule.error?.message}
        </Alert>
      </Snackbar>
    </Paper>
  );
}

function Legend() {
  const item = (swatch: React.ReactNode, label: string) => (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <svg width="18" height="14" aria-hidden>
        {swatch}
      </svg>
      <Typography variant="caption">{label}</Typography>
    </Stack>
  );
  return (
    <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
      {item(<rect x="1" y="3" width="16" height="8" rx="3" fill={SPRINT_COLOR} />, 'Sprint')}
      {item(<rect x="1" y="3" width="16" height="8" rx="3" fill={EPIC_COLOR} />, 'Epic')}
      {item(<GateGlyph x={9} y={7} passed size={6} />, 'Gate passed')}
      {item(<GateGlyph x={9} y={7} passed={false} size={6} />, 'Gate upcoming')}
      {item(<line x1="9" y1="0" x2="9" y2="14" stroke={RAG_COLORS.red} strokeWidth="2" />, 'Today')}
    </Stack>
  );
}

/** Filled diamond with a check mark when passed; hollow dashed diamond when upcoming. */
function GateGlyph({ x, y, passed, size = 9 }: { x: number; y: number; passed: boolean; size?: number }) {
  const theme = useTheme();
  const d = `M ${x} ${y - size} L ${x + size} ${y} L ${x} ${y + size} L ${x - size} ${y} Z`;
  return passed ? (
    <g>
      <path d={d} fill={theme.palette.primary.main} stroke={theme.palette.primary.main} strokeWidth={1.5} />
      <path
        d={`M ${x - size * 0.45} ${y} l ${size * 0.3} ${size * 0.35} l ${size * 0.6} ${-size * 0.7}`}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  ) : (
    <path
      d={d}
      fill={theme.palette.background.default}
      stroke={theme.palette.text.secondary}
      strokeWidth={1.5}
      strokeDasharray="3 2"
    />
  );
}

export function Timeline({
  data,
  zoom,
  today,
  onReschedule,
  criticalPath = noCriticalPath,
}: {
  data: TimelineData;
  zoom: Zoom;
  today: string;
  onReschedule: (bar: Bar, days: number) => void;
  /** Extension point: ids of bars on the critical path get emphasised (Sprint 5). */
  criticalPath?: CriticalPathFn;
}) {
  const theme = useTheme();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const input: TimelineInput = data;
  const model = useMemo(() => buildTimeline(input, zoom, today), [input, zoom, today]);
  const critical = useMemo(() => criticalPath(model, input), [criticalPath, model, input]);
  const [drag, setDrag] = useState<{ id: string; startX: number; dx: number } | null>(null);
  const editable = data.canEdit;
  const scroller = useRef<HTMLDivElement>(null);
  const todayX = model.today?.x;
  // Open with today in view (a third from the left), and keep it there when zooming.
  useEffect(() => {
    const el = scroller.current;
    if (el && todayX !== undefined) el.scrollLeft = Math.max(0, todayX - el.clientWidth / 3);
  }, [todayX, zoom]);
  const muted = theme.palette.text.secondary;
  const grid = theme.palette.divider;
  const bandFill = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.035)' : 'rgba(15,23,42,0.035)';

  const endDrag = (bar: Bar) => {
    if (!drag || drag.id !== bar.id) return;
    const days = dragDays(drag.dx, zoom);
    setDrag(null);
    if (days) onReschedule(bar, days);
  };

  return (
    <Box sx={{ display: 'flex', border: 1, borderColor: 'divider', borderRadius: 3, overflow: 'hidden' }}>
      {/* Row labels (HTML, sticky) */}
      <Box
        sx={{ width: LABEL_W, flexShrink: 0, borderRight: 1, borderColor: 'divider' }}
        aria-hidden
        data-testid="timeline-labels"
      >
        <Box sx={{ height: AXIS_H }} />
        <RowLabel h={PHASE_ROW_H} strong>
          Phases and gates
        </RowLabel>
        <RowLabel h={MILESTONE_ROW_H} strong>
          Milestones
        </RowLabel>
        {model.bars.map((bar) => (
          <RowLabel key={bar.id} h={ROW_H}>
            {bar.kind === 'epic' ? `${bar.key} ${bar.label}` : bar.label}
          </RowLabel>
        ))}
      </Box>

      <Box ref={scroller} sx={{ overflowX: 'auto', flex: 1 }} data-testid="timeline-scroll">
        <Box
          component="svg"
          width={model.width}
          height={model.height}
          role="group"
          aria-label={`Timeline for ${data.project.name}, ${formatDate(model.start)} to ${formatDate(model.end)}`}
          aria-describedby={editable ? 'timeline-help' : undefined}
          sx={{
            display: 'block',
            fontFamily: theme.typography.fontFamily,
            '& .tl-bar': { outline: 'none', cursor: editable ? 'grab' : 'default' },
            '& .tl-bar:focus-visible .tl-bar-rect': { stroke: theme.palette.secondary.main, strokeWidth: 3 },
            '& .tl-bar:focus-visible .tl-bar-focus': { opacity: 1 },
          }}
        >
          <defs>
            <marker
              id="tl-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={muted} />
            </marker>
          </defs>

          {/* Phase bands */}
          {model.phases.map((p, i) => (
            <g key={p.id} data-testid="phase-band" data-gate={p.gate}>
              <title>
                {`Phase ${p.gate} ${p.name}: ${formatDate(p.start)} to ${formatDate(p.end)}${p.derived ? ' (estimated from project dates)' : ''}`}
              </title>
              <rect
                x={p.x}
                y={AXIS_H}
                width={p.w}
                height={model.height - AXIS_H}
                fill={i % 2 === 0 ? bandFill : 'transparent'}
              />
              <line x1={p.x} x2={p.x} y1={AXIS_H} y2={model.height} stroke={grid} />
              <text
                x={p.x + 8}
                y={AXIS_H + 18}
                fontSize={12}
                fontWeight={600}
                fill={theme.palette.text.primary}
              >
                {p.w > 70 ? `${p.gate}. ${p.name}` : p.gate}
              </text>
            </g>
          ))}

          {/* Axis */}
          <g aria-hidden>
            <line x1={0} x2={model.width} y1={AXIS_H} y2={AXIS_H} stroke={grid} />
            {model.ticks.map((t) => (
              <g key={t.date}>
                <line x1={t.x} x2={t.x} y1={AXIS_H - 6} y2={AXIS_H} stroke={muted} />
                <text x={t.x + 4} y={AXIS_H - 12} fontSize={11} fill={muted}>
                  {t.label}
                </text>
              </g>
            ))}
            <line x1={0} x2={model.width} y1={HEADER_H} y2={HEADER_H} stroke={grid} />
          </g>

          {/* Gates */}
          {model.gates.map((g) => (
            <g key={g.phaseId} data-testid="gate-diamond" data-passed={g.passed}>
              <title>{`Gate ${g.gate} (${g.name}): ${g.passed ? 'passed' : 'upcoming'}, ${formatDate(g.date)}`}</title>
              <GateGlyph x={Math.min(g.x, model.width - 10)} y={AXIS_H + 32} passed={g.passed} />
            </g>
          ))}

          {/* Milestones */}
          {model.milestones.map((m) => {
            const y = AXIS_H + PHASE_ROW_H + MILESTONE_ROW_H / 2;
            return (
              <g key={m.id} data-testid={`milestone-${m.kind}`}>
                <title>{`${m.label}: ${formatDate(m.date)}`}</title>
                {m.kind === 'target' ? (
                  <>
                    <path
                      d={`M ${m.x} ${y - 8} L ${m.x + 6} ${y} L ${m.x} ${y + 8} L ${m.x - 6} ${y} Z`}
                      fill={RAG_COLORS.amber}
                    />
                    <text x={m.x + 9} y={y + 4} fontSize={11} fill={theme.palette.text.primary}>
                      Target
                    </text>
                  </>
                ) : (
                  <path
                    d={`M ${m.x} ${y + 7} V ${y - 7} l 8 3.5 l -8 3.5`}
                    fill={SPRINT_COLOR}
                    stroke={SPRINT_COLOR}
                  />
                )}
              </g>
            );
          })}

          {/* Row stripes */}
          {model.bars.map((bar) => (
            <line
              key={`grid-${bar.id}`}
              x1={0}
              x2={model.width}
              y1={HEADER_H + (bar.row + 1) * ROW_H}
              y2={HEADER_H + (bar.row + 1) * ROW_H}
              stroke={grid}
              strokeOpacity={0.5}
            />
          ))}

          {/* Dependencies */}
          <g aria-hidden>
            {model.arrows.map((a) => (
              <path
                key={a.id}
                d={a.path}
                fill="none"
                stroke={muted}
                strokeWidth={1.5}
                markerEnd="url(#tl-arrow)"
                data-testid="dependency-arrow"
              />
            ))}
          </g>

          {/* Bars */}
          {model.bars.map((bar) => {
            const color = bar.kind === 'sprint' ? SPRINT_COLOR : EPIC_COLOR;
            const isCritical = critical.has(bar.id);
            const offset = drag?.id === bar.id ? dragDays(drag.dx, zoom) * model.pxPerDay : 0;
            const label = bar.kind === 'epic' ? `${bar.key} ${bar.label}` : bar.label;
            const fits = bar.w > label.length * 6.5 + 16;
            return (
              <g
                key={bar.id}
                className="tl-bar"
                tabIndex={0}
                role={editable ? 'button' : 'img'}
                aria-roledescription={editable ? 'movable timeline bar' : undefined}
                aria-label={barAriaLabel(bar, { editable, critical: isCritical })}
                data-testid={`bar-${bar.kind}-${bar.id}`}
                data-start={bar.start}
                data-end={bar.end}
                transform={`translate(${offset} 0)`}
                style={{
                  transition: drag || reduceMotion ? 'none' : 'transform 150ms ease-out',
                  touchAction: 'none',
                }}
                onKeyDown={(e) => {
                  if (!editable) return;
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    onReschedule(bar, e.key === 'ArrowRight' ? 1 : -1);
                  }
                }}
                onPointerDown={(e) => {
                  if (!editable || e.button !== 0) return;
                  (e.currentTarget as Element).setPointerCapture(e.pointerId);
                  setDrag({ id: bar.id, startX: e.clientX, dx: 0 });
                }}
                onPointerMove={(e) => {
                  if (drag?.id !== bar.id) return;
                  setDrag({ ...drag, dx: e.clientX - drag.startX });
                }}
                onPointerUp={() => endDrag(bar)}
                onPointerCancel={() => setDrag(null)}
              >
                <title>{`${label}: ${formatDate(bar.start)} to ${formatDate(bar.end)}`}</title>
                <rect
                  className="tl-bar-focus"
                  x={bar.x - 3}
                  y={bar.y - 3}
                  width={bar.w + 6}
                  height={BAR_H + 6}
                  rx={8}
                  fill="none"
                  stroke={theme.palette.secondary.main}
                  strokeWidth={2}
                  opacity={0}
                />
                <rect
                  className="tl-bar-rect"
                  x={bar.x}
                  y={bar.y}
                  width={Math.max(bar.w, 4)}
                  height={BAR_H}
                  rx={6}
                  fill={color}
                  fillOpacity={bar.status === 'completed' || bar.status === 'accepted' ? 0.45 : 0.9}
                  stroke={isCritical ? RAG_COLORS.red : 'none'}
                  strokeWidth={isCritical ? 2.5 : 0}
                  strokeDasharray={
                    bar.kind === 'epic' && bar.source !== 'children' && bar.source !== 'schedule'
                      ? '4 3'
                      : undefined
                  }
                />
                <text
                  x={fits ? bar.x + 8 : bar.x + bar.w + 6}
                  y={bar.y + BAR_H / 2 + 4}
                  fontSize={11}
                  fontWeight={600}
                  fill={fits ? '#FFFFFF' : theme.palette.text.primary}
                  style={{ pointerEvents: 'none' }}
                >
                  {label}
                  {isCritical ? ' (critical)' : ''}
                </text>
              </g>
            );
          })}

          {/* Today */}
          {model.today && (
            <g data-testid="today-line">
              <title>{`Today, ${formatDate(model.today.date)}`}</title>
              <line
                x1={model.today.x}
                x2={model.today.x}
                y1={AXIS_H}
                y2={model.height}
                stroke={RAG_COLORS.red}
                strokeWidth={2}
              />
              <rect
                x={model.today.x - 20}
                y={AXIS_H + PHASE_ROW_H + 2}
                width={40}
                height={16}
                rx={4}
                fill={RAG_COLORS.red}
              />
              <text
                x={model.today.x}
                y={AXIS_H + PHASE_ROW_H + 14}
                fontSize={10}
                fontWeight={700}
                textAnchor="middle"
                fill="#FFFFFF"
              >
                Today
              </text>
            </g>
          )}
        </Box>
      </Box>

      {/* Text alternative for the phase and gate band */}
      <Box component="ul" sx={srOnly} aria-label="Phases and gates">
        {model.phases.map((p) => (
          <li key={p.id}>
            {`Phase ${p.gate} ${p.name}, ${formatDate(p.start)} to ${formatDate(p.end)}. Gate ${p.passed ? 'passed' : 'upcoming'}.`}
          </li>
        ))}
        {model.today && <li>{`Today is ${formatDate(model.today.date)}.`}</li>}
      </Box>
    </Box>
  );
}

function RowLabel({ h, strong, children }: { h: number; strong?: boolean; children: React.ReactNode }) {
  return (
    <Box
      sx={{ height: h, display: 'flex', alignItems: 'center', px: 1.5, borderTop: 1, borderColor: 'divider' }}
    >
      <Typography
        variant="body2"
        noWrap
        sx={{ fontWeight: strong ? 600 : 400 }}
        color={strong ? 'text.secondary' : 'text.primary'}
      >
        {children}
      </Typography>
    </Box>
  );
}
