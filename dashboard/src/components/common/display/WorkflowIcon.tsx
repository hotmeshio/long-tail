import { VARIANT_ICON } from './WorkflowPill';
import { workflowIconGlyph } from '../../../lib/workflow-icons';
import type { WorkflowTier } from '../../../api/types';

/**
 * A workflow's face: its declared icon when it has one, otherwise the glyph
 * of its tier. The same mark heads the form and leads each list row.
 */
export function WorkflowIcon({ icon, tier, className, strokeWidth = 1.5 }: {
  icon: string | null | undefined;
  tier: WorkflowTier;
  className?: string;
  strokeWidth?: number;
}) {
  const Glyph = workflowIconGlyph(icon) ?? VARIANT_ICON[tier];
  return <Glyph className={className} strokeWidth={strokeWidth} aria-hidden />;
}
