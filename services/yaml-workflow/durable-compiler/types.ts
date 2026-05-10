/**
 * Type definitions for the durable-to-YAML compiler.
 */

import type { ActivityManifestEntry, InputFieldMeta } from '../../../types/yaml-workflow';

/** Options for compiling a durable TypeScript workflow to YAML. */
export interface CompileDurableOptions {
  /** TypeScript source code or absolute file path */
  source: string;
  /** When true, `source` is treated as a file path to read from disk */
  isFilePath?: boolean;
  /** Name of the exported workflow function to compile (e.g., "assemblyLine") */
  workflowName: string;
  /** Name for the generated YAML workflow (becomes graph topic) */
  name: string;
  description?: string;
  /** HotMesh app namespace. Defaults to 'longtail'. */
  appId?: string;
  /** Override graph subscribes topic. Defaults to sanitized name. */
  subscribes?: string;
  tags?: string[];
}

/** Result from durable-to-YAML compilation. */
export interface CompileDurableResult {
  yaml: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  activityManifest: ActivityManifestEntry[];
  graphTopic: string;
  appId: string;
  tags: string[];
  inputFieldMeta: InputFieldMeta[];
  category: string;
}

/** Metadata extracted from durable workflow source code by the parser. */
export interface DurableSourceMetadata {
  /** Exported workflow function name */
  workflowFunctionName: string;
  /** Activity function names from proxyActivities destructuring */
  activityNames: string[];
  /** Durable primitive calls detected (sleep, condition, startChild, etc.) */
  durablePrimitives: string[];
  /** Envelope data destructuring shape (field names extracted) */
  envelopeFields: string[];
  /** Import paths for activity modules */
  activityImports: string[];
  /** Control flow markers */
  hasForLoop: boolean;
  hasPromiseAll: boolean;
  hasConditionalBranch: boolean;
  hasEscalation: boolean;
}
