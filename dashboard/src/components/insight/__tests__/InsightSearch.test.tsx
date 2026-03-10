import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../../../api/insight', () => ({
  useInsightQuery: vi.fn(),
  useMcpQuery: vi.fn(),
  useLastInsightQuestion: vi.fn(),
  useLastMcpQueryPrompt: vi.fn(),
}));

import { InsightSearch } from '../InsightSearch';
import { useInsightQuery, useMcpQuery, useLastInsightQuestion, useLastMcpQueryPrompt } from '../../../api/insight';

const EMPTY_QUERY = { data: undefined, isFetching: false, error: null } as any;

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('InsightSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useLastInsightQuestion).mockReturnValue(null);
    vi.mocked(useLastMcpQueryPrompt).mockReturnValue(null);
    vi.mocked(useInsightQuery).mockReturnValue(EMPTY_QUERY);
    vi.mocked(useMcpQuery).mockReturnValue(EMPTY_QUERY);
  });

  it('renders search input with Ask mode placeholder', () => {
    renderWithRouter(<InsightSearch />);
    expect(screen.getByPlaceholderText('Ask about system state...')).toBeInTheDocument();
  });

  it('shows Ask suggestions on focus when input is empty', () => {
    renderWithRouter(<InsightSearch />);
    const input = screen.getByPlaceholderText('Ask about system state...');
    fireEvent.focus(input);
    expect(screen.getByText('Which workflow types have the most escalations?')).toBeInTheDocument();
    expect(screen.getByText('What is the current workload by role?')).toBeInTheDocument();
  });

  it('switches to Do mode and shows Do suggestions', () => {
    renderWithRouter(<InsightSearch />);
    fireEvent.click(screen.getByText('Do'));
    const input = screen.getByPlaceholderText('Do something with tools...');
    fireEvent.focus(input);
    expect(screen.getByText(/Take a screenshot/)).toBeInTheDocument();
  });

  it('hides suggestions when input has text', () => {
    renderWithRouter(<InsightSearch />);
    const input = screen.getByPlaceholderText('Ask about system state...');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'test query' } });
    expect(screen.queryByText('Which workflow types have the most escalations?')).not.toBeInTheDocument();
  });

  it('opens modal with loading state when fetching', () => {
    vi.mocked(useInsightQuery).mockReturnValue({
      data: undefined,
      isFetching: true,
      error: null,
    } as any);

    renderWithRouter(<InsightSearch />);
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

  it('modal has Insight title in Ask mode', () => {
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

  it('modal has MCP Query title in Do mode', () => {
    vi.mocked(useMcpQuery).mockReturnValue({
      data: {
        title: 'Screenshot taken',
        summary: 'Saved to /screenshots/test.png',
        result: { path: '/screenshots/test.png' },
        tool_calls_made: 3,
        prompt: 'take a screenshot',
        workflow_id: 'mcp-1',
        duration_ms: 2000,
      },
      isFetching: false,
      error: null,
    } as any);

    renderWithRouter(<InsightSearch />);
    fireEvent.click(screen.getByText('Do'));
    expect(screen.getByText('MCP Query')).toBeInTheDocument();
    expect(screen.getByText('Screenshot taken')).toBeInTheDocument();
  });
});
