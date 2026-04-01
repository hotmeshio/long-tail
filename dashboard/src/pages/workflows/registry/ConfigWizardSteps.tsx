import { labelCls, hintCls, jsonCls, jsonValid } from './config-form-types';
import type { ConfigFormState } from './config-form-types';
import { RolePicker } from '../../../components/common/form/RolePicker';
import { WorkflowPicker } from '../../../components/common/form/WorkflowPicker';
import { useWorkflowConfigs } from '../../../api/workflows';
import { splitCsv } from '../../../lib/parse';

interface StepProps {
  form: ConfigFormState;
  set: (field: keyof ConfigFormState, value: string | boolean) => void;
}

interface BasicsStepProps extends StepProps {
  editing: boolean;
  durableTypes?: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function csvToArray(csv: string): string[] {
  return splitCsv(csv);
}

function arrayToCsv(arr: string[]): string {
  return arr.join(', ');
}

// ── Step 1: Identity ────────────────────────────────────────────────────────

export function BasicsStep({ form, set, editing, durableTypes = [] }: BasicsStepProps) {
  const showPickList = !editing && durableTypes.length > 0;

  return (
    <div className="space-y-5">
      <div>
        <label className={labelCls}>Workflow Type</label>
        {showPickList && !form.workflow_type ? (
          <div className="space-y-2">
            <p className="text-xs text-text-secondary">
              Select a durable workflow to register as unbreakable:
            </p>
            <div className="grid gap-1">
              {durableTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => set('workflow_type', type)}
                  className="flex items-center gap-2 px-3 py-2 text-left text-xs font-mono rounded-md border border-surface-border hover:border-accent/50 hover:bg-accent/[0.04] transition-colors"
                >
                  {type}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] text-text-tertiary">or</span>
              <input
                type="text"
                onChange={(e) => set('workflow_type', e.target.value)}
                placeholder="Enter a workflow type manually"
                className="input font-mono text-xs flex-1"
              />
            </div>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={form.workflow_type}
              onChange={(e) => set('workflow_type', e.target.value)}
              disabled={editing}
              placeholder="reviewContent"
              className="input font-mono text-xs w-full"
            />
            {!editing && form.workflow_type && durableTypes.length > 0 && (
              <button
                onClick={() => set('workflow_type', '')}
                className="text-[10px] text-accent hover:underline mt-1"
              >
                Choose from durable workflows
              </button>
            )}
          </>
        )}
        <p className={hintCls}>
          Registering a durable workflow makes it unbreakable — the interceptor wraps every execution so failures escalate instead of throwing.
        </p>
      </div>

      <div>
        <label className={labelCls}>Description</label>
        <input
          type="text"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="AI-powered content moderation with human escalation"
          className="input text-xs w-full"
        />
      </div>

      <div>
        <label className={labelCls}>Task Queue</label>
        <input
          type="text"
          value={form.task_queue}
          onChange={(e) => set('task_queue', e.target.value)}
          placeholder="lt-review"
          className="input font-mono text-xs w-full"
        />
        <p className={hintCls}>
          Durable task queue this workflow listens on
        </p>
      </div>
    </div>
  );
}

// ── Step 2: Escalation ──────────────────────────────────────────────────────

export function AccessStep({ form, set }: StepProps) {
  const { data: configs } = useWorkflowConfigs();
  const consumesOptions = (configs ?? [])
    .map((c) => c.workflow_type)
    .filter((t) => t !== form.workflow_type);

  return (
    <div className="space-y-5">
      <p className="text-xs text-text-secondary leading-relaxed">
        Configure how escalations are routed and who can interact with this workflow.
      </p>

      <div>
        <label className={labelCls}>Default Escalation Role</label>
        <RolePicker
          selected={csvToArray(form.default_role)}
          onChange={(roles) => set('default_role', roles[0] ?? '')}
          single
          placeholder="Select escalation role..."
        />
        <p className={hintCls}>
          When this workflow escalates, assign to users with this role
        </p>
      </div>

      <div>
        <label className={labelCls}>Escalation Roles</label>
        <RolePicker
          selected={csvToArray(form.roles)}
          onChange={(roles) => set('roles', arrayToCsv(roles))}
          placeholder="Select who can resolve escalations..."
        />
        <p className={hintCls}>
          Users with any of these roles can claim and resolve escalations from this workflow.
        </p>
      </div>

      <div>
        <label className={labelCls}>Consumes</label>
        <WorkflowPicker
          options={consumesOptions}
          selected={csvToArray(form.consumes)}
          onChange={(workflows) => set('consumes', arrayToCsv(workflows))}
          placeholder="Select workflow dependencies..."
        />
        <p className={hintCls}>
          Output from these upstream workflows will be injected into the input envelope for this workflow.
        </p>
      </div>
    </div>
  );
}

// ── Step 3: Invocation & Schemas ────────────────────────────────────────────

export function SchemasStep({ form, set }: StepProps) {
  return (
    <div className="space-y-5">
      {/* Invocable toggle */}
      <div className="flex gap-6 pt-1">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.invocable}
            onChange={(e) => set('invocable', e.target.checked)}
            className="w-4 h-4 rounded border-border accent-accent"
          />
          <span className="text-xs text-text-primary font-medium">Invocable</span>
        </label>
      </div>
      <p className={hintCls}>
        Allow this workflow to be started from the dashboard or API.
      </p>

      {form.invocable && (
        <>
          {/* Invocation roles */}
          <div>
            <label className={labelCls}>Invocation Roles</label>
            <RolePicker
              selected={csvToArray(form.invocation_roles)}
              onChange={(roles) => set('invocation_roles', arrayToCsv(roles))}
              placeholder="Select who can start this workflow..."
            />
            <p className={hintCls}>
              Only users with these roles can start this workflow.
              Leave empty to allow all authenticated users.
            </p>
          </div>

          {/* Envelope schema */}
          <div>
            <label className={labelCls}>Envelope Schema</label>
            <textarea
              value={form.envelope_schema}
              onChange={(e) => set('envelope_schema', e.target.value)}
              placeholder={`{\n  "data": {\n    "contentId": "example-123",\n    "content": "Text to review"\n  },\n  "metadata": {\n    "source": "dashboard"\n  }\n}`}
              className={jsonCls}
              rows={8}
              spellCheck={false}
            />
            <p className={hintCls}>
              Pre-fills the JSON editor when invoking this workflow.
              Should include <span className="font-mono">data</span> (workflow input) and optional <span className="font-mono">metadata</span> (context).
            </p>
            {form.envelope_schema.trim() && !jsonValid(form.envelope_schema) && (
              <p className="text-[10px] text-status-error mt-1">Invalid JSON</p>
            )}
          </div>
        </>
      )}

      {!form.invocable && (
        <div className="py-4 px-4 bg-surface-sunken/50 rounded-md text-center">
          <p className="text-xs text-text-tertiary">
            Enable <span className="font-medium text-text-secondary">Invocable</span> above to configure who can start this workflow and set an input template.
          </p>
        </div>
      )}

      {/* Resolver schema — always available */}
      <div>
        <label className={labelCls}>Resolver Schema</label>
        <textarea
          value={form.resolver_schema}
          onChange={(e) => set('resolver_schema', e.target.value)}
          placeholder={`{\n  "approved": true,\n  "analysis": {\n    "confidence": 0.95,\n    "flags": [],\n    "summary": "Content meets guidelines"\n  }\n}`}
          className={jsonCls}
          rows={8}
          spellCheck={false}
        />
        <p className={hintCls}>
          The shape of data a human or AI provides when resolving an escalation from this workflow.
          Pre-fills the JSON editor in the escalation resolution form.
        </p>
        {form.resolver_schema.trim() && !jsonValid(form.resolver_schema) && (
          <p className="text-[10px] text-status-error mt-1">Invalid JSON</p>
        )}
      </div>
    </div>
  );
}
