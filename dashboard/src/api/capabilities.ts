import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface CapabilityTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  serverName: string;
  serverId: string;
}

export interface CapabilityCategory {
  name: string;
  tools: CapabilityTool[];
}

export interface CapabilitiesResponse {
  categories: CapabilityCategory[];
  totalTools: number;
}

export function useCapabilities() {
  return useQuery<CapabilitiesResponse>({
    queryKey: ['capabilities'],
    queryFn: () => apiFetch('/capabilities'),
  });
}
