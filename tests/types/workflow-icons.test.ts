import { describe, it, expect } from 'vitest';
import { WORKFLOW_ICONS, isWorkflowIcon } from '../../types/workflow-icons';

describe('WORKFLOW_ICONS', () => {
  it('accepts every curated name and refuses the rest', () => {
    for (const name of Object.values(WORKFLOW_ICONS)) expect(isWorkflowIcon(name)).toBe(true);
    expect(isWorkflowIcon('Sword')).toBe(false);
    expect(isWorkflowIcon('')).toBe(false);
    expect(isWorkflowIcon(null)).toBe(false);
  });

  it('names are unique', () => {
    const values = Object.values(WORKFLOW_ICONS);
    expect(new Set(values).size).toBe(values.length);
  });
});
