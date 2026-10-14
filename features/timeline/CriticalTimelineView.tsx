'use client';
import { TimelineView } from './TimelineView';
import { timelineCriticalPath } from './critical';

/** The project timeline with critical-path analysis wired into its extension point (KH-45). */
export function CriticalTimelineView() {
  return <TimelineView criticalPath={timelineCriticalPath} />;
}
