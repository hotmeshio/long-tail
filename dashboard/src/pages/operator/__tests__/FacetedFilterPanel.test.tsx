import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FacetedFilterPanel } from '../FacetedFilterPanel';
import type { FacetFilters } from '../../../api/escalations';

/** Controlled harness so edits accumulate like they do in the real page. */
function Harness({ onChange }: { onChange: (v: FacetFilters) => void }) {
  const [value, setValue] = useState<FacetFilters>({});
  return (
    <FacetedFilterPanel
      value={value}
      onChange={(v) => { setValue(v); onChange(v); }}
      facetKeys={['confidence', 'source']}
    />
  );
}

describe('FacetedFilterPanel', () => {
  it('coerces a numeric facet value to a number (JSONB containment is type-sensitive)', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.change(screen.getAllByPlaceholderText('key')[0], { target: { value: 'confidence' } });
    fireEvent.change(screen.getAllByPlaceholderText('value')[0], { target: { value: '0.65' } });

    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last.facets).toEqual({ confidence: 0.65 }); // number, not "0.65"
  });

  it('builds a numeric range over a facet', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.change(screen.getAllByPlaceholderText('numeric facet')[0], { target: { value: 'confidence' } });
    const numberInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(numberInput, { target: { value: '0.7' } });

    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last.range).toEqual([{ facet: 'confidence', op: '<=', value: 0.7 }]);
  });

  it('offers only the facet keys that exist (autocomplete datalist)', () => {
    render(<Harness onChange={() => {}} />);
    const options = Array.from(document.querySelectorAll('#lt-facet-keys option')).map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['confidence', 'source']);
  });
});
