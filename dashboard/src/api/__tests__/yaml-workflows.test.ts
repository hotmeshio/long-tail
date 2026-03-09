import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

import {
  useYamlWorkflows,
  useYamlWorkflow,
  useUpdateYamlWorkflow,
  useDeployYamlWorkflow,
  useActivateYamlWorkflow,
  useArchiveYamlWorkflow,
  useDeleteYamlWorkflow,
  useInvokeYamlWorkflow,
  useRegenerateYamlWorkflow,
} from '../yaml-workflows';

// ── Mock fetch ────────────────────────────────────────────────────

const fetchSpy = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
    queryClient,
  };
}

const mockWorkflow = {
  id: 'wf-1',
  name: 'test-pipeline',
  status: 'draft',
  app_id: 'lt-yaml',
  yaml_content: 'app:\n  id: lt-yaml\n',
  activity_manifest: [],
  input_schema: {},
  output_schema: {},
  created_at: '2026-03-09T00:00:00Z',
};

// ── Tests ─────────────────────────────────────────────────────────

describe('yaml-workflows API hooks', () => {
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Queries ──

  describe('useYamlWorkflows', () => {
    it('fetches workflow list', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ workflows: [mockWorkflow], total: 1 }),
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useYamlWorkflows(), { wrapper });

      await waitFor(() => expect(result.current.data).toBeTruthy());

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toContain('/api/yaml-workflows');
      expect(result.current.data?.total).toBe(1);
    });

    it('passes status filter as query param', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ workflows: [], total: 0 }),
      );

      const { wrapper } = createWrapper();
      renderHook(() => useYamlWorkflows({ status: 'active' }), { wrapper });

      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toContain('status=active');
    });
  });

  describe('useYamlWorkflow', () => {
    it('fetches single workflow by id', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(mockWorkflow));

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useYamlWorkflow('wf-1'), { wrapper });

      await waitFor(() => expect(result.current.data).toBeTruthy());

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/yaml-workflows/wf-1');
      expect(result.current.data?.name).toBe('test-pipeline');
    });
  });

  // ── Mutations ──

  describe('useUpdateYamlWorkflow', () => {
    it('sends PUT with yaml_content', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ ...mockWorkflow, yaml_content: 'updated' }),
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useUpdateYamlWorkflow(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          id: 'wf-1',
          yaml_content: 'updated',
        });
      });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/yaml-workflows/wf-1');
      expect(init?.method).toBe('PUT');
      expect(JSON.parse(init?.body as string)).toEqual({
        yaml_content: 'updated',
      });
    });

    it('sends PUT with name and description', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(mockWorkflow));

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useUpdateYamlWorkflow(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          id: 'wf-1',
          name: 'new-name',
          description: 'new desc',
        });
      });

      const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(body).toEqual({ name: 'new-name', description: 'new desc' });
    });
  });

  describe('useDeployYamlWorkflow', () => {
    it('sends POST to deploy endpoint', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ ...mockWorkflow, status: 'deployed' }),
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useDeployYamlWorkflow(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('wf-1');
      });

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/yaml-workflows/wf-1/deploy');
      expect(init?.method).toBe('POST');
    });
  });

  describe('useActivateYamlWorkflow', () => {
    it('sends POST to activate endpoint', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ ...mockWorkflow, status: 'active' }),
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useActivateYamlWorkflow(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('wf-1');
      });

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/yaml-workflows/wf-1/activate');
      expect(init?.method).toBe('POST');
    });
  });

  describe('useArchiveYamlWorkflow', () => {
    it('sends POST to archive endpoint', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ ...mockWorkflow, status: 'archived' }),
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useArchiveYamlWorkflow(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('wf-1');
      });

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/yaml-workflows/wf-1/archive');
      expect(init?.method).toBe('POST');
    });
  });

  describe('useDeleteYamlWorkflow', () => {
    it('sends DELETE request', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ deleted: true }));

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useDeleteYamlWorkflow(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('wf-1');
      });

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/yaml-workflows/wf-1');
      expect(init?.method).toBe('DELETE');
    });
  });

  describe('useInvokeYamlWorkflow', () => {
    it('sends POST with data and sync flag', async () => {
      fetchSpy.mockResolvedValueOnce(
        jsonResponse({ result: { rotated: true }, job_id: 'j-1' }),
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useInvokeYamlWorkflow(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          id: 'wf-1',
          data: { image_ref: 'page1.png', degrees: 180 },
          sync: true,
        });
      });

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/yaml-workflows/wf-1/invoke');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init?.body as string);
      expect(body.data).toEqual({ image_ref: 'page1.png', degrees: 180 });
      expect(body.sync).toBe(true);
    });
  });

  describe('useRegenerateYamlWorkflow', () => {
    it('sends POST to regenerate endpoint', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(mockWorkflow));

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useRegenerateYamlWorkflow(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: 'wf-1', task_queue: 'lt-triage' });
      });

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('/api/yaml-workflows/wf-1/regenerate');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({ task_queue: 'lt-triage' });
    });
  });
});
