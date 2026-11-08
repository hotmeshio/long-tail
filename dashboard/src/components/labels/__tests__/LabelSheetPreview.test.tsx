import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { buildLabelSheet } from '../../../../../shared/labels/layout';
import { resolveMedia } from '../../../../../shared/labels/media';
import { LabelSheetPreview } from '../LabelSheetPreview';

const sheet = buildLabelSheet({
  media: resolveMedia('a4-l7160'),
  labels: Array.from({ length: 23 }, (_, i) => ({
    title: `A-${i + 1}`, lines: ['<b>Acme</b>'], codes: [{ code: `13:0:A-${i + 1}`, caption: 'Check in', tone: 'solid' as const }],
  })),
  symbology: 'code128',
  humanReadable: true,
});

describe('LabelSheetPreview', () => {
  it('renders every page with its labels and the stock', () => {
    const { container } = render(<LabelSheetPreview sheet={sheet} warnings={[]} />);
    expect(screen.getByText(/23 labels on 2 pages/)).toBeInTheDocument();
    expect(container.querySelectorAll('svg.lt-print-page')).toHaveLength(2);
    expect(container.querySelectorAll('[data-code="13:0:A-1"]')).toHaveLength(1);
  });

  it('renders label text as text, never markup', () => {
    const { container } = render(<LabelSheetPreview sheet={sheet} warnings={[]} />);
    expect(container.querySelector('svg b')).toBeNull();
  });

  it('lists warnings by label number', () => {
    render(<LabelSheetPreview sheet={sheet} warnings={[{ index: 4, kind: 'unresolved', detail: 'A-5 names no row today' }]} />);
    expect(screen.getByRole('list', { name: 'Label warnings' })).toHaveTextContent('Label 5 · A-5 names no row today');
  });
});
