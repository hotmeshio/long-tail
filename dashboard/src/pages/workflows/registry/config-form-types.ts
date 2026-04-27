import type { LTWorkflowConfig } from '../../../api/types';

export interface ConfigFormState {
  workflow_type: string;
  description: string;
  task_queue: string;
  default_role: string;
  invocable: boolean;
  roles: string;
  invocation_roles: string;
  consumes: string;
  envelope_schema: string;
  resolver_schema: string;
  cron_schedule: string;
  execute_as: string;
  /** UI-only — gates escalation fields in the wizard. Not sent to backend. */
  certified: boolean;
}

export const EMPTY_FORM: ConfigFormState = {
  workflow_type: '',
  description: '',
  task_queue: '',
  default_role: 'reviewer',
  invocable: false,
  roles: '',
  invocation_roles: '',
  consumes: '',
  envelope_schema: '',
  resolver_schema: '',
  cron_schedule: '',
  execute_as: '',
  certified: false,
};

export function configToForm(c: LTWorkflowConfig): ConfigFormState {
  const roles = (c.roles ?? []).join(', ');
  const consumes = (c.consumes ?? []).join(', ');
  return {
    workflow_type: c.workflow_type,
    description: c.description ?? '',
    task_queue: c.task_queue ?? '',
    default_role: c.default_role,
    invocable: c.invocable,
    roles,
    invocation_roles: (c.invocation_roles ?? []).join(', '),
    consumes,
    envelope_schema: c.envelope_schema ? JSON.stringify(c.envelope_schema, null, 2) : '',
    resolver_schema: c.resolver_schema ? JSON.stringify(c.resolver_schema, null, 2) : '',
    cron_schedule: c.cron_schedule ?? '',
    execute_as: c.execute_as ?? '',
    certified: !!(roles || consumes),
  };
}

export const STEP_LABELS = ['Identity', 'Invocation', 'Advanced'];

export function jsonValid(v: string): boolean {
  if (!v.trim()) return true;
  try { JSON.parse(v); return true; } catch { return false; }
}

export function isStepValid(step: number, form: ConfigFormState): boolean {
  if (step === 1) return !!form.workflow_type.trim();
  if (step === 2) return jsonValid(form.envelope_schema);
  if (step === 3) return jsonValid(form.resolver_schema);
  return true;
}

export const labelCls = 'block text-[10px] font-semibold uppercase tracking-widest text-text-tertiary mb-1';
export const hintCls = 'text-[10px] text-text-tertiary mt-2 leading-relaxed';
export const jsonCls = 'input font-mono text-[11px] w-full leading-relaxed tabular-nums';

export const DEFAULT_ENVELOPE = '{\n  "data": {},\n  "metadata": {}\n}';
