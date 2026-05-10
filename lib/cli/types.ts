export interface DiscoveredWorkflow {
  path: string;
  relativePath: string;
  functionName: string;
  activities: string[];
  primitives: string[];
  activityImportPaths: string[];
  framework: 'hotmesh-durable' | 'temporal' | 'unknown';
}

export interface CompileOptions {
  dryRun?: boolean;
  output?: string;
  model?: string;
  function?: string;
}
