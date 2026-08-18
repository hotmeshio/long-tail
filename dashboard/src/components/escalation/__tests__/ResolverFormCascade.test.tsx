import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ResolverForm } from '../ResolverForm';

// Cascading selects — a field whose x-lt-options path embeds {{resolver.*}}
// interpolation follows the live form: disabled until the parent answers,
// populated the moment it does, re-resolved locally on every edit.

function formJson(fields: Record<string, unknown>, schema?: Record<string, unknown>) {
  const data: Record<string, unknown> = { ...fields };
  if (schema) data._form_schema = schema;
  return JSON.stringify(data, null, 2);
}

const CTX = {
  lookup: {
    geo: {
      countries: ['US', 'EU'],
      regions: {
        US: ['CA', 'NY'],
        // Object options work at any cascade level: label shown, value emitted.
        EU: [{ value: 'de-1', label: 'Germany' }, { id: 'fr-1', label: 'France' }],
      },
    },
  },
};

const SCHEMA = {
  properties: {
    country: { type: 'string', 'x-lt-options': 'lookup.geo.countries' },
    region: { type: 'string', 'x-lt-options': 'lookup.geo.regions.{{resolver.country}}' },
  },
};

function getSelect(fieldKey: string): HTMLSelectElement {
  const el = document.querySelector(`select[data-field-key="${fieldKey}"]`);
  if (!el) throw new Error(`no select for ${fieldKey}`);
  return el as HTMLSelectElement;
}

describe('ResolverForm cascading selects', () => {
  it('renders the child DISABLED on the Choose… placeholder while the parent is unanswered', () => {
    const json = formJson({ country: '', region: '' }, SCHEMA);
    render(<ResolverForm value={json} onChange={vi.fn()} escalationContext={CTX} />);
    expect(getSelect('country').disabled).toBe(false);
    const region = getSelect('region');
    expect(region.disabled).toBe(true);
    expect(region.options).toHaveLength(1);
    expect(region.options[0].text).toBe('Choose…');
  });

  it('enables and populates the child the moment the parent answer lands', () => {
    const json = formJson({ country: 'US', region: '' }, SCHEMA);
    render(<ResolverForm value={json} onChange={vi.fn()} escalationContext={CTX} />);
    const region = getSelect('region');
    expect(region.disabled).toBe(false);
    expect(Array.from(region.options).map((o) => o.text)).toEqual(['Choose…', 'CA', 'NY']);
  });

  it('a changed parent resets the child presentation to the placeholder', () => {
    // The stored region value belongs to US; with EU chosen it is no longer
    // among the options, so the select shows Choose… (the stale value is
    // rejected by the membership pass on submit).
    const json = formJson({ country: 'EU', region: 'CA' }, SCHEMA);
    render(<ResolverForm value={json} onChange={vi.fn()} escalationContext={CTX} />);
    const region = getSelect('region');
    expect(region.value).toBe('');
    expect(Array.from(region.options).map((o) => o.text)).toEqual(['Choose…', 'Germany', 'France']);
  });

  it('choosing the parent emits, the child follows — object options show labels, emit values', () => {
    const onChange = vi.fn();
    const json = formJson({ country: '', region: '' }, SCHEMA);
    const { rerender } = render(
      <ResolverForm value={json} onChange={onChange} escalationContext={CTX} />,
    );
    fireEvent.change(getSelect('country'), { target: { value: 'EU' } });
    const afterCountry = onChange.mock.calls[0][0] as string;
    expect(JSON.parse(afterCountry).country).toBe('EU');
    rerender(<ResolverForm value={afterCountry} onChange={onChange} escalationContext={CTX} />);
    const region = getSelect('region');
    expect(region.disabled).toBe(false);
    expect(Array.from(region.options).map((o) => o.text)).toEqual(['Choose…', 'Germany', 'France']);

    fireEvent.change(region, { target: { value: 'de-1' } });
    const afterRegion = onChange.mock.calls[onChange.mock.calls.length - 1][0] as string;
    expect(JSON.parse(afterRegion).region).toBe('de-1');
  });
});
