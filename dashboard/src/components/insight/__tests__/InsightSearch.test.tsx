import { render, screen, fireEvent } from '@testing-library/react';
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
    vi.mocked(useInsightQuery).mockReturnValue({
      data: undefined,
      isFetching: false,
      error: null,
    } as any);
  });

  it('renders search input with sparkle icon placeholder', () => {
    renderWithRouter(<InsightSearch />);
    expect(
      screen.getByPlaceholderText('Which workflow types have the most escalations?'),
    ).toBeInTheDocument();
  });

  it('shows suggestion dropdown on focus when input is empty', () => {
    renderWithRouter(<InsightSearch />);
    const input = screen.getByPlaceholderText('Which workflow types have the most escalations?');
    fireEvent.focus(input);
    expect(screen.getByText('Show me all escalated processes')).toBeInTheDocument();
    expect(screen.getByText('What is the current workload by role?')).toBeInTheDocument();
  });

  it('hides suggestions when input has text', () => {
    renderWithRouter(<InsightSearch />);
    const input = screen.getByPlaceholderText('Which workflow types have the most escalations?');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'test query' } });
    expect(screen.queryByText('Show me all escalated processes')).not.toBeInTheDocument();
  });

  it('opens modal with loading state when fetching', () => {
    vi.mocked(useInsightQuery).mockReturnValue({
      data: undefined,
      isFetching: true,
      error: null,
    } as any);

    renderWithRouter(<InsightSearch />);
    // Modal should be open with loading skeleton (animate-pulse)
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows error in modal', () => {
    vi.mocked(useInsightQuery).mockReturnValue({
      data: undefined,
      isFetching: false,
      error: new Error('Analysis failed'),
    } as any);

    renderWithRouter(<InsightSearch />);
    expect(screen.getByText('Analysis failed')).toBeInTheDocument();
  });

  it('shows result in modal when data is present', () => {
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

  it('modal has Insight title and close button', () => {
    vi.mocked(useInsightQuery).mockReturnValue({
      data: {
        title: 'Result',
        summary: 'Summary.',
        sections: [],
        metrics: [],
        tool_calls_made: 1,
        query: 'q',
        workflow_id: 'wf-1',
        duration_ms: 500,
      },
      isFetching: false,
      error: null,
    } as any);

    renderWithRouter(<InsightSearch />);
    expect(screen.getByText('Insight')).toBeInTheDocument();
  });
});
