import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../../../api/insight', () => ({
  useInsightQuery: vi.fn(),
  useLastInsightQuestion: vi.fn(),
}));

import { InsightSearch } from '../InsightSearch';
import { useInsightQuery, useLastInsightQuestion } from '../../../api/insight';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('InsightSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useLastInsightQuestion).mockReturnValue(null);
  });

  it('renders search input and Ask button', () => {
    vi.mocked(useInsightQuery).mockReturnValue({
      data: undefined,
      isFetching: false,
      error: null,
    } as any);

    renderWithRouter(<InsightSearch />);

    expect(screen.getByPlaceholderText('Ask about your processes...')).toBeInTheDocument();
    expect(screen.getByText('Ask')).toBeInTheDocument();
  });

  it('renders all 6 suggestion chips', () => {
    vi.mocked(useInsightQuery).mockReturnValue({
      data: undefined,
      isFetching: false,
      error: null,
    } as any);

    renderWithRouter(<InsightSearch />);

    expect(screen.getByText('Show me all escalated processes')).toBeInTheDocument();
    expect(screen.getByText("What is the current workload by role?")).toBeInTheDocument();
    expect(screen.getByText("Summarize today's activity")).toBeInTheDocument();
    expect(screen.getByText('How many tasks completed in the last 24 hours?')).toBeInTheDocument();
    expect(screen.getByText('Which workflow types have the most escalations?')).toBeInTheDocument();
  });

  it('renders the telemetry suggestion chip', () => {
    vi.mocked(useInsightQuery).mockReturnValue({
      data: undefined,
      isFetching: false,
      error: null,
    } as any);

    renderWithRouter(<InsightSearch />);

    expect(
      screen.getByText(
        'Trace the most recent failed task — what happened in the workflow execution?',
      ),
    ).toBeInTheDocument();
  });

  it('disables Ask button when input is empty', () => {
    vi.mocked(useInsightQuery).mockReturnValue({
      data: undefined,
      isFetching: false,
      error: null,
    } as any);

    renderWithRouter(<InsightSearch />);

    const button = screen.getByText('Ask');
    expect(button).toBeDisabled();
  });

  it('shows loading state with Analyzing button and skeleton', () => {
    vi.mocked(useInsightQuery).mockReturnValue({
      data: undefined,
      isFetching: true,
      error: null,
    } as any);

    renderWithRouter(<InsightSearch />);

    expect(screen.getByText('Analyzing...')).toBeInTheDocument();
  });

  it('renders error message', () => {
    vi.mocked(useInsightQuery).mockReturnValue({
      data: undefined,
      isFetching: false,
      error: new Error('Analysis failed'),
    } as any);

    renderWithRouter(<InsightSearch />);

    expect(screen.getByText('Analysis failed')).toBeInTheDocument();
  });

  it('renders InsightResultCard when data is present', () => {
    vi.mocked(useInsightQuery).mockReturnValue({
      data: {
        title: 'Test Insight Result',
        summary: 'Everything looks good.',
        sections: [],
        metrics: [],
        tool_calls_made: 2,
        query: 'test query',
        workflow_id: 'wf-1',
        duration_ms: 1500,
      },
      isFetching: false,
      error: null,
    } as any);

    renderWithRouter(<InsightSearch />);

    expect(screen.getByText('Test Insight Result')).toBeInTheDocument();
    expect(screen.getByText('Everything looks good.')).toBeInTheDocument();
  });

  it('restores last question from cache', () => {
    vi.mocked(useLastInsightQuestion).mockReturnValue('Previous question?');
    vi.mocked(useInsightQuery).mockReturnValue({
      data: undefined,
      isFetching: false,
      error: null,
    } as any);

    renderWithRouter(<InsightSearch />);

    const input = screen.getByPlaceholderText('Ask about your processes...') as HTMLInputElement;
    expect(input.value).toBe('Previous question?');
  });
});
