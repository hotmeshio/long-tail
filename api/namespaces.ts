import * as namespaceService from '../services/namespace';
import type { LTApiResult } from '../types/sdk';

/**
 * List all registered namespaces.
 *
 * @returns `{ status: 200, data: { namespaces: LTNamespace[] } }`
 */
export async function listNamespaces(): Promise<LTApiResult> {
  try {
    const namespaces = await namespaceService.listNamespaces();
    return { status: 200, data: { namespaces } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Register a new namespace.
 *
 * @param input.name — unique namespace identifier
 * @param input.description — human-readable description
 * @param input.metadata — arbitrary key-value metadata
 * @returns `{ status: 200, data: <namespace record> }`
 */
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
