import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { renderWithProviders } from '../../../../test/render';
import { DocumentWidget } from '../DocumentWidget';
import { ResolverForm } from '../../resolver-form/ResolverForm';
import { FRAME_PAD } from '../document/ViewerToolbar';

const openPdf = vi.fn();
vi.mock('../document/pdf-loader', () => ({ openPdf: (url: string) => openPdf(url) }));

const LATER = new Date(Date.now() + 15 * 60_000).toISOString();
const EARLIER = new Date(Date.now() - 60_000).toISOString();

const ctx = (file: Record<string, unknown>) => ({
  escalation: { id: 'esc-1' },
  file: { referral: { as: 'referral', path: 'referrals/r-1.pdf', name: 'r-1.pdf', contentType: 'application/pdf', ...file } },
});

const SCHEMA = { type: 'string', title: 'Referral', 'x-lt-widget': 'document', 'x-lt-source': 'file.referral' };

function fakeDoc(numPages: number) {
  const page = {
    getViewport: () => ({ width: 600, height: 800 }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  };
  return { doc: { numPages, getPage: vi.fn().mockResolvedValue(page) }, destroy: vi.fn().mockResolvedValue(undefined) };
}

describe('DocumentWidget', () => {
  // jsdom paints nothing; the page holder and its controls are what is under test.
  beforeAll(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); });
  beforeEach(() => openPdf.mockReset());

  it('reads a PDF from its signed link and pages it', async () => {
    openPdf.mockResolvedValue(fakeDoc(3));
    renderWithProviders(
      <DocumentWidget fieldKey="referral" value="" onChange={vi.fn()} schema={SCHEMA} escalationContext={ctx({ url: 'https://s3.test/r-1.pdf?sig=1', expiresAt: LATER })} />,
    );
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    expect(openPdf).toHaveBeenCalledWith('https://s3.test/r-1.pdf?sig=1');
    expect(screen.getByLabelText('Open in a new tab')).toHaveAttribute('href', 'https://s3.test/r-1.pdf?sig=1');
  });

  it('keeps the open document when the same file arrives re-signed', async () => {
    openPdf.mockResolvedValue(fakeDoc(2));
    const { rerender } = renderWithProviders(
      <DocumentWidget fieldKey="referral" value="" onChange={vi.fn()} schema={SCHEMA} escalationContext={ctx({ url: 'https://s3.test/a?sig=1', expiresAt: LATER })} />,
    );
    await screen.findByText('1 / 2');
    rerender(
      <DocumentWidget fieldKey="referral" value="" onChange={vi.fn()} schema={SCHEMA} escalationContext={ctx({ url: 'https://s3.test/a?sig=2', expiresAt: LATER })} />,
    );
    await waitFor(() => expect(screen.getByLabelText('Open in a new tab')).toHaveAttribute('href', 'https://s3.test/a?sig=2'));
    expect(openPdf).toHaveBeenCalledTimes(1);
  });

  it('shows an image from its link', () => {
    renderWithProviders(
      <DocumentWidget fieldKey="card" value="" onChange={vi.fn()} schema={{ ...SCHEMA, 'x-lt-source': 'file.referral' }}
        escalationContext={ctx({ url: 'https://s3.test/card.png?sig=1', contentType: 'image/png', name: 'card.png', expiresAt: LATER })} />,
    );
    expect(screen.getByTestId('document-image')).toHaveAttribute('src', 'https://s3.test/card.png?sig=1');
    expect(screen.getByTestId('document-image-frame')).toHaveStyle({ padding: `${FRAME_PAD}px` });
  });

  it('asks for a fresh link when the one it holds has lapsed', () => {
    const { queryClient } = renderWithProviders(
      <DocumentWidget fieldKey="referral" value="" onChange={vi.fn()} schema={SCHEMA} escalationContext={ctx({ url: 'https://s3.test/a?sig=1', expiresAt: EARLIER })} />,
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    expect(openPdf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Get a fresh link'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['escalations', 'esc-1', 'files'] });
  });

  it('says why a ref has no link', () => {
    renderWithProviders(
      <DocumentWidget fieldKey="referral" value="" onChange={vi.fn()} schema={SCHEMA} escalationContext={ctx({ error: 'JWT_SECRET not configured' })} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('JWT_SECRET not configured');
  });

  it('says so when nothing is attached', () => {
    renderWithProviders(<DocumentWidget fieldKey="referral" value="" onChange={vi.fn()} schema={SCHEMA} escalationContext={{}} />);
    expect(screen.getByText('No document attached')).toBeInTheDocument();
  });

  it('stays live on a locked form: reading is not editing', async () => {
    openPdf.mockResolvedValue(fakeDoc(2));
    const onDisabledClick = vi.fn();
    const form = JSON.stringify({
      referral: '',
      name: 'Ana',
      _form_schema: { 'x-lt-layout': 'split', properties: { referral: SCHEMA, name: { type: 'string' } } },
    });
    renderWithProviders(
      <ResolverForm value={form} onChange={vi.fn()} disabled onDisabledClick={onDisabledClick}
        escalationContext={ctx({ url: 'https://s3.test/a?sig=1', expiresAt: LATER })} />,
    );
    await screen.findByText('1 / 2');
    expect(screen.getByTestId('document-referral').closest('[inert]')).toBeNull();
    expect(screen.getByDisplayValue('Ana').closest('[inert]')).not.toBeNull();
    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(onDisabledClick).not.toHaveBeenCalled();
  });
});
