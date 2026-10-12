import { describe, expect, it } from 'vitest';
import { positionAt } from './ordering';
import type { WorkItem } from '@/lib/domain/types';

const col = (ps: number[]) => ps.map((p, i) => ({ id: `i${i}`, position: p }) as WorkItem);

describe('positionAt', () => {
  it('places into an empty column', () => expect(positionAt([], 0, 'x')).toBe(1000));
  it('places at the top', () => expect(positionAt(col([1000, 2000]), 0, 'x')).toBe(0));
  it('places at the bottom', () => expect(positionAt(col([1000, 2000]), 2, 'x')).toBe(3000));
  it('places between neighbours', () => expect(positionAt(col([1000, 2000]), 1, 'x')).toBe(1500));
  it('ignores the moving item itself', () => expect(positionAt(col([1000, 2000, 3000]), 1, 'i0')).toBe(2500));
});
