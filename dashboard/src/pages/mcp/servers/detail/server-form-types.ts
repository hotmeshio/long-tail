import type { McpServerRecord, McpToolManifest } from '../../../../api/types';

export interface ServerFormState {
  name: string;
  description: string;
  mode: 'in-process' | 'network' | 'local-process';
  transport_type: 'stdio' | 'sse' | 'streamable-http';
  // stdio fields
  command: string;
  args: string;
  env_vars: string;
  // network fields
  url: string;
  // shared
  auto_connect: boolean;
  tags: string[];
  compile_hints: string;
  credential_providers: string[];
  discovered_tools: McpToolManifest[] | null;
}

export const EMPTY_FORM: ServerFormState = {
  name: '',
  description: '',
  mode: 'network',
  transport_type: 'sse',
  command: '',
  args: '',
  env_vars: '{}',
  url: '',
  auto_connect: false,
  tags: [],
  compile_hints: '',
  credential_providers: [],
  discovered_tools: null,
};

export function serverToForm(s: McpServerRecord): ServerFormState {
  const config = s.transport_config ?? {};
  const isBuiltin = !!(config as any).builtin;

  let mode: ServerFormState['mode'] = 'network';
  if (isBuiltin) mode = 'in-process';
  else if (s.transport_type === 'stdio') mode = 'local-process';

  return {
    name: s.name,
    description: s.description ?? '',
    mode,
    transport_type: s.transport_type,
    command: (config as any).command ?? '',
    args: ((config as any).args ?? []).join(', '),
    env_vars: (config as any).env ? JSON.stringify((config as any).env, null, 2) : '{}',
    url: (config as any).url ?? '',
    auto_connect: s.auto_connect,
    tags: s.tags ?? [],
    compile_hints: (s as any).compile_hints ?? '',
    credential_providers: s.credential_providers ?? [],
    discovered_tools: s.tool_manifest ?? null,
  };
}

export function formToPayload(form: ServerFormState) {
  let transport_config: Record<string, unknown> = {};

  if (form.mode === 'local-process') {
    transport_config = {
      command: form.command.trim(),
      args: form.args.split(',').map((a) => a.trim()).filter(Boolean),
      env: form.env_vars.trim() ? JSON.parse(form.env_vars) : undefined,
    };
  } else if (form.mode === 'network') {
    transport_config = { url: form.url.trim() };
  }
  // in-process: transport_config stays empty (server manages it)

  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    transport_type: form.mode === 'local-process' ? 'stdio' as const : form.transport_type,
    transport_config,
    auto_connect: form.auto_connect,
    tags: form.tags,
    compile_hints: form.compile_hints.trim() || undefined,
    credential_providers: form.credential_providers.length > 0 ? form.credential_providers : undefined,
  };
}

export const STEP_LABELS = ['Transport', 'Discovery', 'Test', 'Review'];

export function isStepValid(step: number, form: ServerFormState): boolean {
  if (step === 1) {
    if (!form.name.trim()) return false;
    if (form.mode === 'network' && !form.url.trim()) return false;
    if (form.mode === 'local-process' && !form.command.trim()) return false;
    return true;
  }
  return true;
}

export const labelCls = 'block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1';
export const hintCls = 'text-[10px] text-text-tertiary mt-2 leading-relaxed';
