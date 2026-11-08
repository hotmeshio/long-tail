import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  previewMutate: vi.fn(),
  issueMutate: vi.fn(),
  previewData: null as any,
  printSheet: vi.fn(),
}));

vi.mock('../../../api/labels', () => ({
  useLabelMedia: () => ({ data: { media: [
    { id: 'a4-cr80', name: 'A4 · ID cards', family: 'sheet', columns: 2, rows: 5 },
    { id: 'thermal-4x2', name: 'Thermal 4x2', family: 'thermal', columns: 1, rows: 1 },
  ], defaultMedia: 'a4-cr80' } }),
  useLabelTransports: () => ({ data: { transports: [] } }),
  usePreviewLabels: () => ({ mutate: mocks.previewMutate, data: mocks.previewData, isPending: false, error: null }),
  useIssueLabels: () => ({ mutate: mocks.issueMutate, isPending: false, error: null }),
}));
vi.mock('../../../lib/print-sheet', () => ({ printSheet: mocks.printSheet }));
vi.mock('../../../api/roles', () => ({ useRoles: () => ({ data: { roles: ['gluer', 'finisher'] } }) }));
vi.mock('../LabelSheetPreview', () => ({ LabelSheetPreview: () => <div>pages</div> }));

import { PrintLabelsPanel } from '../PrintLabelsPanel';

const badge = {
  name: 'associate-badge', scheme_version: 11, title: 'Associate badge', description: null,
  codes: [{ category: '0', tone: 'plain' }], text: {}, symbology: 'qrcode', human_readable: false,
  media: 'a4-cr80', sensitive: true, enabled: true, revision: 1, source: 'api',
} as const;
const item = { ...badge, name: 'item-label', title: 'Item label', scheme_version: 13, sensitive: false, symbology: 'code128' } as const;

function renderPanel(template: typeof badge | typeof item, identity = false) {
  return render(
    <PrintLabelsPanel
      open
      onClose={() => {}}
      title="Print"
      templates={[template as any]}
      source={{ kind: 'users', userIds: ['u1', 'u2'] }}
      sourceCount={2}
      identity={identity}
    />,
  );
}

async function previewFirst(u: ReturnType<typeof userEvent.setup>) {
  mocks.previewMutate.mockImplementation((_req, opts) => {
    mocks.previewData = { sheet: {}, warnings: [], labelCount: 2 };
    opts?.onSuccess?.();
  });
  await u.click(screen.getByRole('button', { name: 'Preview' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.previewData = null;
});

describe('PrintLabelsPanel', () => {
  it('prints only after a preview of the same choice', async () => {
    const u = userEvent.setup();
    const { rerender } = renderPanel(item);
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
    await previewFirst(u);
    rerender(<PrintLabelsPanel open onClose={() => {}} title="Print" templates={[item as any]} source={{ kind: 'users', userIds: ['u1', 'u2'] }} sourceCount={2} />);
    expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled();
  });

  it('an open template prints without a confirmation', async () => {
    const u = userEvent.setup();
    const { rerender } = renderPanel(item);
    await previewFirst(u);
    rerender(<PrintLabelsPanel open onClose={() => {}} title="Print" templates={[item as any]} source={{ kind: 'users', userIds: ['u1', 'u2'] }} sourceCount={2} />);
    await u.click(screen.getByRole('button', { name: 'Print' }));
    expect(mocks.issueMutate).toHaveBeenCalledWith(expect.objectContaining({ template: 'item-label', output: 'sheet', confirm: undefined }), expect.any(Object));
  });

  it('a badge asks first; Keep sends nothing', async () => {
    const u = userEvent.setup();
    const { rerender } = renderPanel(badge, true);
    await previewFirst(u);
    rerender(<PrintLabelsPanel open onClose={() => {}} title="Print" templates={[badge as any]} source={{ kind: 'users', userIds: ['u1', 'u2'] }} sourceCount={2} identity />);
    await u.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.getByText('Print 2 badges')).toBeInTheDocument();
    expect(screen.getByText(/recorded as the requester, with each holder named/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Keep' }));
    expect(mocks.issueMutate).not.toHaveBeenCalled();
  });

  it('confirming a badge print sends confirm: true and prints the issued sheet', async () => {
    const u = userEvent.setup();
    mocks.issueMutate.mockImplementation((_req, opts) => opts.onSuccess({ jobId: 'j1', sheet: { pages: [] } }));
    const { rerender } = renderPanel(badge, true);
    await previewFirst(u);
    rerender(<PrintLabelsPanel open onClose={() => {}} title="Print" templates={[badge as any]} source={{ kind: 'users', userIds: ['u1', 'u2'] }} sourceCount={2} identity />);
    await u.click(screen.getByRole('button', { name: 'Print' }));
    await u.click(screen.getByRole('button', { name: 'Confirm and print' }));
    expect(mocks.issueMutate).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'associate-badge', source: { kind: 'users', userIds: ['u1', 'u2'] }, output: 'sheet', confirm: true }),
      expect.any(Object),
    );
    expect(mocks.printSheet).toHaveBeenCalledWith({ pages: [] });
  });

  it('thermal media offer ZPL instead of Print', async () => {
    const u = userEvent.setup();
    renderPanel(item);
    await u.selectOptions(screen.getByLabelText('Media'), 'thermal-4x2');
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download ZPL' })).toBeInTheDocument();
  });
});

describe('PrintLabelsPanel badges without a selection', () => {
  it('offers everyone with a badge or everyone in a role, and previews that source', async () => {
    const u = userEvent.setup();
    render(<PrintLabelsPanel open onClose={() => {}} title="Print badges" templates={[badge as any]} identity />);
    expect(screen.getByLabelText('Badges for')).toHaveValue('all');
    await u.selectOptions(screen.getByLabelText('Badges for'), 'role');
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
    await u.selectOptions(screen.getByLabelText('Role'), 'gluer');
    await u.click(screen.getByRole('button', { name: 'Preview' }));
    expect(mocks.previewMutate).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'associate-badge', source: { kind: 'users', role: 'gluer' } }),
      expect.any(Object),
    );
  });
});
