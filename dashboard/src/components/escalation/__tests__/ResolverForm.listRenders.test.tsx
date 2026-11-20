import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const renders = vi.hoisted(() => ({ counts: {} as Record<string, number> }));

vi.mock('../resolver-form/list/PillsField', () => ({
  PillsField: ({ fieldKey, value, onChange }: { fieldKey: string; value: unknown[]; onChange: (v: unknown) => void }) => {
    renders.counts[fieldKey] = (renders.counts[fieldKey] ?? 0) + 1;
    return <button type="button" data-testid={`add-${fieldKey}`} onClick={() => onChange([...value, 'x'])}>{fieldKey}:{value.length}</button>;
  },
}));

import { ResolverForm } from '../resolver-form/ResolverForm';

const props = Object.fromEntries(
  Array.from({ length: 6 }, (_, i) => [`list${i}`, { type: 'array', title: `List ${i}`, items: { type: 'string' } }]),
);
const SCHEMA = { 'x-lt-confidence': true, properties: { name: { type: 'string' }, ...props } };
const START = { name: 'a', ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`list${i}`, ['p', 'q']])) };
const CTX = { envelope: { formDefaults: START, confidence: { list0: 0.5 } } } as any;

function Harness() {
  const [json, setJson] = useState(JSON.stringify({ ...START, _form_schema: SCHEMA }));
  return <ResolverForm value={json} onChange={setJson} escalationContext={CTX} />;
}

describe('a list edit does not re-render the other lists', () => {
  it('re-renders only the edited list', () => {
    render(<Harness />);
    const before = { ...renders.counts };
    fireEvent.click(screen.getByTestId('add-list3'));
    expect(screen.getByTestId('add-list3').textContent).toBe('list3:3');
    for (const key of Object.keys(before)) {
      if (key === 'list3') continue;
      expect(renders.counts[key]).toBe(before[key]);
    }
    expect(renders.counts.list3).toBeGreaterThan(before.list3);
  });
});
