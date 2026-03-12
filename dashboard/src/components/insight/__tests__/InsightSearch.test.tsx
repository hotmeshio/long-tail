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

  it('renders search input with Do mode placeholder by default', () => {
    renderWithRouter(<InsightSearch />);
    expect(screen.getByPlaceholderText('Do something with tools...')).toBeInTheDocument();
  });

  it('shows suggestions on focus when input is empty', () => {
    renderWithRouter(<InsightSearch />);
    const input = screen.getByPlaceholderText('Do something with tools...');
    fireEvent.focus(input);
    expect(screen.getByText(/fill #username with "superadmin".*home\.png/)).toBeInTheDocument();
    expect(screen.getByText(/screenshot of https:\/\/example\.com/)).toBeInTheDocument();
  });

  it('hides suggestions when input has text', () => {
    renderWithRouter(<InsightSearch />);
    const input = screen.getByPlaceholderText('Do something with tools...');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'test query' } });
    expect(screen.queryByText(/Run a browser script/)).not.toBeInTheDocument();
  });

  it('opens modal with loading state when fetching', () => {
    vi.mocked(useMcpQuery).mockReturnValue({
      data: undefined,
      isFetching: true,
      error: null,
    } as any);

    renderWithRouter(<InsightSearch />);
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows error in modal', () => {
    vi.mocked(useMcpQuery).mockReturnValue({
      data: undefined,
      isFetching: false,
      error: new Error('Tool call failed'),
    } as any);

    renderWithRouter(<InsightSearch />);
    expect(screen.getByText('Tool call failed')).toBeInTheDocument();
  });

  it('shows result in modal when data is present', () => {
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
    expect(screen.getByText('Screenshot taken')).toBeInTheDocument();
    expect(screen.getByText(/Saved to/)).toBeInTheDocument();
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
    expect(screen.getByText('MCP Query')).toBeInTheDocument();
  });

  it('does not render Ask/Do toggle buttons', () => {
    renderWithRouter(<InsightSearch />);
    expect(screen.queryByText('Ask')).not.toBeInTheDocument();
    expect(screen.queryByText('Do')).not.toBeInTheDocument();
  });
});
