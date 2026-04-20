import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../../api/workflow-builder', () => ({
  useCreateDirectYamlWorkflow: vi.fn(),
}));

vi.mock('../../../../api/yaml-workflows', () => ({
  useYamlWorkflow: vi.fn(),
  useUpdateYamlWorkflow: vi.fn(),
}));

vi.mock('../../../../components/common/form/TagInput', () => ({
  TagInput: ({ tags }: any) => <div data-testid="tag-input">{tags.join(',')}</div>,
}));

import { BuilderProfilePanel } from '../BuilderProfilePanel';
import { useCreateDirectYamlWorkflow } from '../../../../api/workflow-builder';
import { useYamlWorkflow, useUpdateYamlWorkflow } from '../../../../api/yaml-workflows';

const builderData = {
  name: 'analyze-page',
  description: 'Analyzes a web page',
  yaml: 'app:\n  id: longtail',
  input_schema: { type: 'object' },
  activity_manifest: [{ activity_id: 'a1' }],
  tags: ['web', 'analysis'],
};

const mutateAsync = vi.fn();

function setup(overrides: Record<string, any> = {}) {
  vi.mocked(useCreateDirectYamlWorkflow).mockReturnValue({ mutateAsync, isPending: false } as any);
  vi.mocked(useUpdateYamlWorkflow).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as any);
  vi.mocked(useYamlWorkflow).mockReturnValue({ data: undefined } as any);

  const props = {
    builderData,
    resolvedYamlId: null,
    originalPrompt: 'Analyze the HotMesh homepage',
    onBack: vi.fn(),
    onCreate: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BuilderProfilePanel {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, props };
}

describe('BuilderProfilePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders panel heading and description', () => {
    setup();
    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText(/Name the MCP server and tool/)).toBeInTheDocument();
  });

  it('renders original prompt when provided', () => {
    setup();
    expect(screen.getByText('Analyze the HotMesh homepage')).toBeInTheDocument();
    expect(screen.getByText('Original Prompt')).toBeInTheDocument();
  });

  it('does not render original prompt when not provided', () => {
    setup({ originalPrompt: undefined });
    expect(screen.queryByText('Original Prompt')).not.toBeInTheDocument();
  });

  it('renders editable form fields when not created', () => {
    setup();
    expect(screen.getByDisplayValue('longtail')).toBeInTheDocument();
    expect(screen.getByDisplayValue('analyze-page')).toBeInTheDocument();
    expect(screen.getByText('MCP Server Name')).toBeInTheDocument();
    expect(screen.getByText('MCP Tool Name')).toBeInTheDocument();
  });

  it('renders Create & Save button when not created', () => {
    setup();
    expect(screen.getByText('Create & Save')).toBeInTheDocument();
    expect(screen.queryByText('Next: Deploy')).not.toBeInTheDocument();
  });

  it('disables Create & Save when name is empty', () => {
    setup({ builderData: { ...builderData, name: '' } });
    expect(screen.getByText('Create & Save')).toBeDisabled();
  });

  it('calls onCreate with yaml ID on create', async () => {
    mutateAsync.mockResolvedValue({ id: 'yaml-123' });
    const { props } = setup();

    await act(async () => {
      fireEvent.click(screen.getByText('Create & Save'));
    });

    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      name: 'analyze-page',
      yaml_content: builderData.yaml,
      app_id: 'longtail',
      tags: ['web', 'analysis'],
    }));
    expect(props.onCreate).toHaveBeenCalledWith('yaml-123');
  });

  it('renders Next: Deploy button when already created', () => {
    setup({ resolvedYamlId: 'yaml-123' });
    expect(screen.getByText('Next: Deploy')).toBeInTheDocument();
    expect(screen.queryByText('Create & Save')).not.toBeInTheDocument();
  });

  it('shows read-only view when created', () => {
    vi.mocked(useYamlWorkflow).mockReturnValue({
      data: { app_id: 'longtail', name: 'analyze-page', description: 'Test desc', tags: ['web'] },
    } as any);
    setup({ resolvedYamlId: 'yaml-123' });
    // Should not have input fields
    expect(screen.queryByDisplayValue('analyze-page')).not.toBeInTheDocument();
    // Should show Edit button
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('calls onBack when Back button clicked', () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('Back'));
    expect(props.onBack).toHaveBeenCalledOnce();
  });

  it('calls onNext when Next: Deploy clicked', () => {
    const { props } = setup({ resolvedYamlId: 'yaml-123' });
    fireEvent.click(screen.getByText('Next: Deploy'));
    expect(props.onNext).toHaveBeenCalledOnce();
  });
});
