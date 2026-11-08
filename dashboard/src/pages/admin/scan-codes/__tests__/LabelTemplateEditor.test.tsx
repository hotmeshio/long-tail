import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), remove: vi.fn() }));
vi.mock('../../../../api/labels', () => ({
  useLabelMedia: () => ({ data: { media: [{ id: 'a4-l7160', name: 'A4 L7160' }], defaultMedia: 'a4-l7160' } }),
  useUpsertLabelTemplate: () => ({ mutate: mocks.upsert, isPending: false, error: null }),
  useDeleteLabelTemplate: () => ({ mutate: mocks.remove, isPending: false, error: null }),
}));

import { LabelTemplateEditor } from '../LabelTemplateEditor';

const rules = [
  { scheme_version: 14, category: '0', name: 'Check in', steps: [], enabled: true },
  { scheme_version: 14, category: '1', name: 'Check out', steps: [], enabled: true },
] as any[];

beforeEach(() => vi.clearAllMocks());

describe('LabelTemplateEditor', () => {
  it('saves a new two-code template', async () => {
    const u = userEvent.setup();
    render(<LabelTemplateEditor schemeVersion={14} identity={false} rules={rules} template={null} onDone={() => {}} />);
    await u.type(screen.getByLabelText(/^Name/), 'two-code-label');
    await u.type(screen.getByLabelText(/^Title/), 'Two-code label');
    await u.click(screen.getByText('Add a code'));
    await u.selectOptions(screen.getByLabelText('Action 2'), '1');
    await u.click(screen.getByRole('button', { name: 'Save template' }));
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'two-code-label', scheme_version: 14, title: 'Two-code label', sensitive: false, expected_revision: undefined,
      codes: [{ category: '0', tone: 'solid' }, { category: '1', tone: 'outline' }],
    }), expect.any(Object));
  });

  it('an edit names the revision it read', async () => {
    const u = userEvent.setup();
    const template = {
      name: 'two-code-label', scheme_version: 14, title: 'Two-code label', description: null, codes: [{ category: '0', tone: 'solid' }],
      text: { title: '{target}', lines: [] }, symbology: 'code128', human_readable: true, media: null, sensitive: false,
      enabled: true, revision: 7, source: 'api',
    } as any;
    render(<LabelTemplateEditor schemeVersion={14} identity={false} rules={rules} template={template} onDone={() => {}} />);
    expect(screen.getByLabelText(/^Name/)).toBeDisabled();
    await u.click(screen.getByRole('button', { name: 'Save template' }));
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ expected_revision: 7 }), expect.any(Object));
  });

  it('a badge template is always sensitive and defaults to user tokens and QR', async () => {
    const u = userEvent.setup();
    render(<LabelTemplateEditor schemeVersion={11} identity rules={[rules[0]]} template={null} onDone={() => {}} />);
    expect(screen.queryByLabelText('Printing')).toBeNull();
    expect(screen.getByLabelText('Heading')).toHaveValue('{user.display_name}');
    await u.type(screen.getByLabelText(/^Name/), 'badge');
    await u.type(screen.getByLabelText(/^Title/), 'Badge');
    await u.click(screen.getByRole('button', { name: 'Save template' }));
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ sensitive: true, symbology: 'qrcode', human_readable: false }), expect.any(Object));
  });
});
