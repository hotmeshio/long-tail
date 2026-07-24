import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LinkWidget } from '../LinkWidget';

vi.mock('../../../../lib/x-lt-help', () => ({
  interpolateHelp: (template: string, ctx: Record<string, unknown>) =>
    template.replace(/\{\{(\w+)\.(\w+)\}\}/g, (_: string, domain: string, key: string) => {
      const d = ctx[domain] as Record<string, string> | undefined;
      return d?.[key] ?? '';
    }),
}));

function renderWidget(
  schema: Record<string, unknown>,
  escalationContext?: Record<string, unknown>,
) {
  return render(
    <MemoryRouter>
      <LinkWidget
        fieldKey="queue_link"
        value=""
        onChange={vi.fn()}
        schema={schema}
        escalationContext={escalationContext}
      />
    </MemoryRouter>,
  );
}

describe('LinkWidget', () => {
  it('renders the field title as the link label', () => {
    renderWidget({
      title: 'View originator queue',
      'x-lt-href': '/escalations/available?role=rel-originator',
    });
    // The title appears in both the FieldLabel and the link anchor; check by role
    expect(screen.getByRole('link', { name: /View originator queue/ })).toBeInTheDocument();
  });

  it('falls back to description as label when title is absent', () => {
    renderWidget({
      description: 'Opens the originator queue',
      'x-lt-href': '/escalations/available?role=rel-originator',
    });
    // When title is absent, description is used for the link label; verify via testid
    expect(screen.getByTestId('link-widget-queue_link')).toBeInTheDocument();
    expect(screen.getAllByText('Opens the originator queue').length).toBeGreaterThanOrEqual(1);
  });

  it('renders an internal link (starts with "/") navigable inside the dashboard', () => {
    renderWidget(
      {
        title: 'Go to queue',
        'x-lt-href': '/escalations/available?role=rel-originator',
      },
    );
    const link = screen.getByTestId('link-widget-queue_link');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/escalations/available?role=rel-originator');
    expect(link).not.toHaveAttribute('target');
  });

  it('renders an external URL in a new tab with rel=noreferrer', () => {
    renderWidget({
      title: 'External',
      'x-lt-href': 'https://example.test/report',
    });
    const link = screen.getByTestId('link-widget-queue_link');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  it('interpolates {{metadata.orderId}} into the href from escalation context', () => {
    renderWidget(
      {
        title: 'Order queue',
        'x-lt-href': '/escalations/available?facets={"orderId":"{{metadata.orderId}}"}',
      },
      { metadata: { orderId: 'ORD-999' } },
    );
    const link = screen.getByTestId('link-widget-queue_link');
    expect(link).toHaveAttribute('href', '/escalations/available?facets={"orderId":"ORD-999"}');
  });

  it('renders a placeholder when href is empty', () => {
    renderWidget({ title: 'Empty', 'x-lt-href': '' });
    expect(screen.getByText('No link configured')).toBeInTheDocument();
    expect(screen.queryByTestId('link-widget-queue_link')).not.toBeInTheDocument();
  });

  it('renders a placeholder when x-lt-href is absent from schema', () => {
    renderWidget({ title: 'No href' });
    expect(screen.getByText('No link configured')).toBeInTheDocument();
  });
});
