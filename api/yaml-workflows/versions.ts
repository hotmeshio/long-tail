import * as yamlDb from '../../services/yaml-workflow/db';
import type { LTApiResult } from '../../types/sdk';
import { isNotFoundError } from './helpers';

/**
 * Retrieve the version history for a YAML workflow.
 *
 * Returns a paginated list of version snapshots ordered by version number.
 *
 * @param input.id — UUID of the workflow
 * @param input.limit — max versions to return (defaults to 20)
 * @param input.offset — pagination offset (defaults to 0)
 * @returns `{ status: 200, data: VersionSnapshot[] }` paginated version history
 */
export async function getVersionHistory(input: {
  id: string;
  limit?: number;
  offset?: number;
}): Promise<LTApiResult> {
  try {
    const limit = input.limit ?? 20;
    const offset = input.offset ?? 0;
    const result = await yamlDb.getVersionHistory(input.id, limit, offset);
    return { status: 200, data: result };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Retrieve a specific version snapshot of a YAML workflow.
 *
 * Validates that the version number is a positive integer before querying.
 *
 * @param input.id — UUID of the workflow
 * @param input.version — 1-based version number to retrieve
 * @returns `{ status: 200, data: VersionSnapshot }` the snapshot at the requested version, or 404
 */
export async function getVersionSnapshot(input: {
  id: string;
  version: number;
}): Promise<LTApiResult> {
  try {
    const version = input.version;
    if (isNaN(version) || version < 1) {
      return { status: 400, error: 'Invalid version number' };
    }
    const snapshot = await yamlDb.getVersionSnapshot(input.id, version);
    if (!snapshot) {
      return { status: 404, error: `Version ${version} not found` };
    }
    return { status: 200, data: snapshot };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}

/**
 * Retrieve the raw YAML content for a workflow, optionally at a specific version.
 *
 * When a version is provided, fetches from the version snapshot table. Otherwise
 * returns the current yaml_content from the live workflow record.
 *
 * @param input.id — UUID of the workflow
 * @param input.version — optional version number; when omitted, returns the current content
 * @returns `{ status: 200, data: string }` the raw YAML string
 */
export async function getYamlContent(input: {
  id: string;
  version?: number;
}): Promise<LTApiResult<string>> {
  try {
    if (input.version) {
      const snapshot = await yamlDb.getVersionSnapshot(input.id, input.version);
      if (!snapshot) {
        return { status: 404, error: `Version ${input.version} not found` };
      }
      return { status: 200, data: snapshot.yaml_content };
    }
    const wf = await yamlDb.getYamlWorkflow(input.id);
    if (!wf) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 200, data: wf.yaml_content };
  } catch (err: any) {
    if (isNotFoundError(err)) {
      return { status: 404, error: 'YAML workflow not found' };
    }
    return { status: 500, error: err.message };
  }
}
