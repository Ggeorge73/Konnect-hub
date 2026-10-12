import { closureError, type RaidEntry } from '../domain/raid';
import { ValidationError } from './errors';

/** Shape rules every RAID store applies before saving (the database re-checks closure and ranges). */
export function checkShape(
  e: Pick<
    RaidEntry,
    | 'kind'
    | 'category'
    | 'probability'
    | 'impact'
    | 'severity'
    | 'residualProbability'
    | 'residualImpact'
    | 'status'
    | 'closureNote'
  >,
) {
  if (e.kind === 'risk' && (!e.category || !e.probability || !e.impact))
    throw new ValidationError('A risk needs a category, probability and impact.');
  if (e.kind === 'issue' && !e.severity) throw new ValidationError('An issue needs a severity.');
  if (e.kind === 'risk' && Boolean(e.residualProbability) !== Boolean(e.residualImpact))
    throw new ValidationError('Set both residual probability and residual impact, or neither.');
  const err = closureError(e.kind, e.status, e.closureNote);
  if (err) throw new ValidationError(err);
}
