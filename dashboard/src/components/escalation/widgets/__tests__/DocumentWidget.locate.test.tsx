import { screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { renderWithProviders } from '../../../../test/render';
import { DocumentWidget } from '../DocumentWidget';
import { DocumentLocatorContext, createDocumentLocator } from '../../resolver-form/document-pane';

const openPdf = vi.fn();
vi.mock('../document/pdf-loader', () => ({ openPdf: (url: string) => openPdf(url) }));

const LATER = new Date(Date.now() + 15 * 60_000).toISOString();
const SCHEMA = { type: 'string', title: 'Review', 'x-lt-widget': 'document', 'x-lt-source': 'file.review' };
const CTX = {
  escalation: { id: 'esc-1' },
  file: { review: { as: 'review', path: 'r.pdf', name: 'r.pdf', contentType: 'application/pdf', url: 'https://s3.test/r.pdf', expiresAt: LATER } },
};

/** A document whose pages carry the given text lines; a page with none has no text layer. */
function fakeDoc(pages: string[][]) {
  const viewport = { width: 600, height: 800, convertToViewportRectangle: ([x1, y1, x2, y2]: number[]) => [x1, 800 - y2, x2, 800 - y1] };
  const page = (lines: string[]) => ({
    getViewport: () => viewport,
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    getTextContent: async () => ({ items: lines.map((str, i) => ({ str, transform: [1, 0, 0, 1, 10, 700 - i * 20], width: str.length * 5, height: 10 })) }),
  });
  return { doc: { numPages: pages.length, getPage: vi.fn(async (n: number) => page(pages[n - 1])) }, destroy: vi.fn().mockResolvedValue(undefined) };
}

function draw(pages: string[][]) {
  openPdf.mockResolvedValue(fakeDoc(pages));
  const locator = createDocumentLocator();
  renderWithProviders(
    <DocumentLocatorContext.Provider value={locator}>
      <DocumentWidget fieldKey="review" value="" onChange={vi.fn()} schema={SCHEMA} escalationContext={CTX} />
    </DocumentLocatorContext.Provider>,
  );
  return locator;
}

describe('document locator in the PDF viewer', () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    Element.prototype.scrollTo = vi.fn();
  });
  beforeEach(() => openPdf.mockReset());

  it('highlights a quote on the page that holds it, searching when no page is given', async () => {
    const locator = draw([['Intro text'], ['Callus formation at 1st metatarsal heads.']]);
    await screen.findByText('1 / 2');
    await act(async () => { locator.locate('file.review', { quote: 'formation at 1st' }); });
    await waitFor(() => expect(screen.getAllByTestId('document-highlight')).toHaveLength(1));
  });

  it('goes to the named page and paints nothing when the page has no text layer', async () => {
    const locator = draw([[], []]);
    await screen.findByText('1 / 2');
    await act(async () => { locator.locate('file.review', { page: 2, quote: 'anything' }); });
    await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument());
    expect(screen.queryByTestId('document-highlight')).toBeNull();
  });

  it('is silent when the quote is nowhere in the document', async () => {
    const locator = draw([['One'], ['Two']]);
    await screen.findByText('1 / 2');
    await act(async () => { locator.locate('file.review', { quote: 'missing passage' }); });
    expect(screen.queryByTestId('document-highlight')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
