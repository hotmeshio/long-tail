import * as namespaceService from '../services/namespace';
import type { LTApiResult } from '../types/sdk';

export async function listNamespaces(): Promise<LTApiResult> {
  try {
    const namespaces = await namespaceService.listNamespaces();
    return { status: 200, data: { namespaces } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function registerNamespace(input: {
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
}): Promise<LTApiResult> {
  try {
    const { name, description, metadata } = input;
    if (!name || typeof name !== 'string') {
      return { status: 400, error: 'name is required' };
    }
    const namespace = await namespaceService.registerNamespace(name, description, metadata);
    return { status: 200, data: namespace };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
