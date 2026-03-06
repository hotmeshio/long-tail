import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { InsightResultCard } from '../InsightResultCard';
import type { InsightResult } from '../../../api/insight';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const baseResult: InsightResult = {
  title: 'System Overview',
  summary: 'All systems operational with 95% completion rate.',
  sections: [
    {
      heading: 'Performance',
      content: 'Task throughput is strong at 42 per hour.',
    },
    {
      heading: 'Action Required',
      content: '3 escalations pending review.',
    },
  ],
  metrics: [
    { label: 'Completion Rate', value: '95%' },
    { label: 'Pending', value: '5' },
    { label: 'Throughput (1h)', value: '42' },
  ],
  tool_calls_made: 3,
  query: 'Show system overview',
  workflow_id: 'insight-test-001',
  duration_ms: 2500,
};

describe('InsightResultCard', () => {
  it('renders title', () => {
    renderWithRouter(<InsightResultCard result={baseResult} />);
    expect(screen.getByText('System Overview')).toBeInTheDocument();
  });

  it('renders summary text', () => {
    renderWithRouter(<InsightResultCard result={baseResult} />);
    expect(
      screen.getByText('All systems operational with 95% completion rate.'),
    ).toBeInTheDocument();
  });

  it('renders all metrics with labels and values', () => {
    renderWithRouter(<InsightResultCard result={baseResult} />);

    expect(screen.getByText('Completion Rate')).toBeInTheDocument();
    expect(screen.getByText('95%')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Throughput (1h)')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders section headings and content', () => {
    renderWithRouter(<InsightResultCard result={baseResult} />);

    expect(screen.getByText('Performance')).toBeInTheDocument();
    expect(
      screen.getByText('Task throughput is strong at 42 per hour.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Action Required')).toBeInTheDocument();
    expect(screen.getByText('3 escalations pending review.')).toBeInTheDocument();
  });

  it('renders tool call count and duration', () => {
    renderWithRouter(<InsightResultCard result={baseResult} />);

    expect(screen.getByText('3 tool calls')).toBeInTheDocument();
    expect(screen.getByText('2.5s')).toBeInTheDocument();
  });

  it('renders singular "tool call" for count of 1', () => {
    const singleCall = { ...baseResult, tool_calls_made: 1 };
    renderWithRouter(<InsightResultCard result={singleCall} />);

    expect(screen.getByText('1 tool call')).toBeInTheDocument();
  });

  it('omits metrics section when array is empty', () => {
    const noMetrics = { ...baseResult, metrics: [] };
    renderWithRouter(<InsightResultCard result={noMetrics} />);

    // Title should still render
    expect(screen.getByText('System Overview')).toBeInTheDocument();
    // Metric labels should not appear
    expect(screen.queryByText('Completion Rate')).not.toBeInTheDocument();
  });

  it('omits sections when array is empty', () => {
    const noSections = { ...baseResult, sections: [] };
    renderWithRouter(<InsightResultCard result={noSections} />);

    expect(screen.getByText('System Overview')).toBeInTheDocument();
    expect(screen.queryByText('Performance')).not.toBeInTheDocument();
  });

  it('converts markdown links to React Router Links', () => {
    const withLinks: InsightResult = {
      ...baseResult,
      summary:
        'See [processClaim task](/workflows/tasks/detail/abc-123) for details.',
    };

    renderWithRouter(<InsightResultCard result={withLinks} />);

    const link = screen.getByText('processClaim task');
    expect(link).toBeInTheDocument();
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/workflows/tasks/detail/abc-123');
  });

  it('renders multiple links in text', () => {
    const withMultipleLinks: InsightResult = {
      ...baseResult,
      sections: [
        {
          heading: 'Links',
          content:
            'Check [task A](/tasks/aaa) and [task B](/tasks/bbb) for details.',
        },
      ],
    };

    renderWithRouter(<InsightResultCard result={withMultipleLinks} />);

    const linkA = screen.getByText('task A');
    expect(linkA.getAttribute('href')).toBe('/tasks/aaa');
    const linkB = screen.getByText('task B');
    expect(linkB.getAttribute('href')).toBe('/tasks/bbb');
  });

  it('preserves plain text without links', () => {
    const plainText: InsightResult = {
      ...baseResult,
      summary: 'No links here, just plain text.',
    };

    renderWithRouter(<InsightResultCard result={plainText} />);
    expect(screen.getByText('No links here, just plain text.')).toBeInTheDocument();
  });

  it('renders external https links as <a> with target="_blank"', () => {
    const withExternal: InsightResult = {
      ...baseResult,
      summary:
        'View trace: [View trace in Honeycomb](https://ui.honeycomb.io/team/environments/test/datasets/long-tail/trace?trace_id=abc123).',
    };

    renderWithRouter(<InsightResultCard result={withExternal} />);

    const link = screen.getByText('View trace in Honeycomb');
    expect(link).toBeInTheDocument();
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe(
      'https://ui.honeycomb.io/team/environments/test/datasets/long-tail/trace?trace_id=abc123',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
