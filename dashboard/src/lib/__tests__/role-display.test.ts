import { describe, it, expect } from 'vitest';
import { deriveRoleTitle, displayRoleTitle } from '../role-display';

describe('deriveRoleTitle', () => {
  it('reads camelCase as spaced Title Case', () => {
    expect(deriveRoleTitle('printFarm')).toBe('Print Farm');
  });

  it('reads kebab-case as spaced Title Case', () => {
    expect(deriveRoleTitle('print-farm')).toBe('Print Farm');
    expect(deriveRoleTitle('final-qa-review')).toBe('Final Qa Review');
  });

  it('reads snake_case as spaced Title Case', () => {
    expect(deriveRoleTitle('print_farm')).toBe('Print Farm');
  });

  it('preserves interior capitals so acronym segments keep their shape', () => {
    expect(deriveRoleTitle('printQA')).toBe('Print QA');
    expect(deriveRoleTitle('QAReview')).toBe('QA Review');
  });

  it('handles single words and mixed separators', () => {
    expect(deriveRoleTitle('finishing')).toBe('Finishing');
    expect(deriveRoleTitle('soleGen-review')).toBe('Sole Gen Review');
  });
});

describe('displayRoleTitle', () => {
  it('prefers the user-set title', () => {
    expect(displayRoleTitle({ role: 'print-farm', title: 'Print Fleet' })).toBe('Print Fleet');
  });

  it('derives from the role id when the title is missing or blank', () => {
    expect(displayRoleTitle({ role: 'printFarm', title: null })).toBe('Print Farm');
    expect(displayRoleTitle({ role: 'printFarm', title: '  ' })).toBe('Print Farm');
    expect(displayRoleTitle({ role: 'printFarm' })).toBe('Print Farm');
  });
});
