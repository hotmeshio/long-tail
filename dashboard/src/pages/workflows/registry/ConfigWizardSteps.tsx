import { labelCls, hintCls, jsonCls, jsonValid } from './config-form-types';
import type { ConfigFormState } from './config-form-types';

interface StepProps {
  form: ConfigFormState;
  set: (field: keyof ConfigFormState, value: string | boolean) => void;
}

interface BasicsStepProps extends StepProps {
  editing: boolean;
}

export function BasicsStep({ form, set, editing }: BasicsStepProps) {
  return (
    <div className="space-y-5">
      <div>
        <label className={labelCls}>Workflow Type</label>
        <input
          type="text"
          value={form.workflow_type}
          onChange={(e) => set('workflow_type', e.target.value)}
          disabled={editing}
          placeholder="reviewContent"
          className="input font-mono text-xs w-full"
        />
        <p className={hintCls}>
          Unique identifier for this workflow. Must match the function name registered with the worker.
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

      <div className="grid grid-cols-2 gap-4">
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
        <div>
          <label className={labelCls}>Default Role</label>
          <input
            type="text"
            value={form.default_role}
            onChange={(e) => set('default_role', e.target.value)}
            placeholder="reviewer"
            className="input text-xs w-full"
          />
          <p className={hintCls}>
            Escalations route to users with this role
          </p>
        </div>
      </div>

      <div>
        <label className={labelCls}>Default Modality</label>
        <input
          type="text"
          value={form.default_modality}
          onChange={(e) => set('default_modality', e.target.value)}
          placeholder="portal"
          className="input text-xs w-full"
        />
        <p className={hintCls}>
          How escalations are delivered: <span className="font-mono">portal</span>, <span className="font-mono">email</span>, or <span className="font-mono">sms</span>
        </p>
      </div>

      <div>
        <label className={labelCls}>Cron Schedule</label>
        <input
          type="text"
          value={form.cron_schedule}
          onChange={(e) => set('cron_schedule', e.target.value)}
          placeholder="0 */6 * * *"
          className="input font-mono text-xs w-full"
        />
        <p className={hintCls}>
          Optional cron expression for scheduled execution
        </p>
      </div>

      <div className="flex gap-6 pt-1">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_lt}
            onChange={(e) => set('is_lt', e.target.checked)}
            className="w-4 h-4 rounded border-border accent-accent"
          />
          <span className="text-xs text-text-primary">LT Workflow</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_container}
            onChange={(e) => set('is_container', e.target.checked)}
            className="w-4 h-4 rounded border-border accent-accent"
          />
          <span className="text-xs text-text-primary">Container</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.invocable}
            onChange={(e) => set('invocable', e.target.checked)}
            className="w-4 h-4 rounded border-border accent-accent"
          />
          <span className="text-xs text-text-primary">Invocable</span>
        </label>
      </div>
      <p className={hintCls}>
        <span className="font-medium text-text-secondary">Container</span> = orchestrator that spawns child workflows.{' '}
        <span className="font-medium text-text-secondary">Invocable</span> = can be started from the dashboard.
      </p>
    </div>
  );
}

export function AccessStep({ form, set }: StepProps) {
  return (
    <div className="space-y-5">
      <p className="text-xs text-text-secondary leading-relaxed">
        Control which roles can interact with this workflow and its escalations.
      </p>

      <div>
        <label className={labelCls}>Roles</label>
        <input
          type="text"
          value={form.roles}
          onChange={(e) => set('roles', e.target.value)}
          placeholder="reviewer, engineer, admin"
          className="input text-xs w-full"
        />
        <p className={hintCls}>
          Comma-separated. Users with any of these roles can claim and resolve escalations from this workflow.
        </p>
      </div>

      <div>
        <label className={labelCls}>Invocation Roles</label>
        <input
          type="text"
          value={form.invocation_roles}
          onChange={(e) => set('invocation_roles', e.target.value)}
          placeholder="engineer, admin"
          className="input text-xs w-full"
        />
        <p className={hintCls}>
          Comma-separated. Only users with these roles can start this workflow from the dashboard.
          Leave empty to allow all authenticated users.
        </p>
      </div>

      <div>
        <label className={labelCls}>Consumes</label>
        <input
          type="text"
          value={form.consumes}
          onChange={(e) => set('consumes', e.target.value)}
          placeholder="reviewContent, verifyDocument"
          className="input text-xs w-full"
        />
        <p className={hintCls}>
          Comma-separated. Other workflow types whose output this workflow depends on.
          Used by orchestrators to declare child workflow dependencies.
        </p>
      </div>
    </div>
  );
}

export function SchemasStep({ form, set }: StepProps) {
  return (
    <div className="space-y-5">
      <p className="text-xs text-text-secondary leading-relaxed">
        JSON templates that pre-fill editors in the dashboard. Not validated at runtime — these are developer hints.
      </p>

      {form.invocable ? (
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
            Pre-fills the JSON editor on the <span className="font-medium text-text-secondary">Start Workflow</span> page.
            Should include <span className="font-mono">data</span> (workflow input) and optional <span className="font-mono">metadata</span> (context).
          </p>
          {form.envelope_schema.trim() && !jsonValid(form.envelope_schema) && (
            <p className="text-[10px] text-status-error mt-1">Invalid JSON</p>
          )}
        </div>
      ) : (
        <div className="py-4 text-center">
          <p className="text-xs text-text-tertiary">
            Envelope schema is only available for invocable workflows.
          </p>
          <p className="text-[10px] text-text-tertiary mt-1">
            Enable <span className="font-medium">Invocable</span> on the Basics step to configure this.
          </p>
        </div>
      )}

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
          Pre-fills the JSON editor when an operator resolves an escalation from this workflow.
          Should match the shape your workflow expects in the resolver callback.
        </p>
        {form.resolver_schema.trim() && !jsonValid(form.resolver_schema) && (
          <p className="text-[10px] text-status-error mt-1">Invalid JSON</p>
        )}
      </div>
    </div>
  );
}

export function HooksStep({ form, set }: StepProps) {
  return (
    <div className="space-y-5">
      <p className="text-xs text-text-secondary leading-relaxed">
        Lifecycle hooks run before or after workflow execution. Use them for logging, metrics, notifications, or data enrichment.
      </p>

      <div>
        <label className={labelCls}>Lifecycle</label>
        <textarea
          value={form.lifecycle}
          onChange={(e) => set('lifecycle', e.target.value)}
          placeholder={`{\n  "onBefore": [\n    {\n      "type": "log",\n      "config": { "level": "info" }\n    }\n  ],\n  "onAfter": [\n    {\n      "type": "notify",\n      "config": { "channel": "#ops" }\n    }\n  ]\n}`}
          className={jsonCls}
          rows={12}
          spellCheck={false}
        />
        <p className={hintCls}>
          <span className="font-mono">onBefore</span> hooks execute before the workflow starts.{' '}
          <span className="font-mono">onAfter</span> hooks execute after it completes or fails.
          Each hook has a <span className="font-mono">type</span> and optional <span className="font-mono">config</span>.
        </p>
        {form.lifecycle.trim() && !jsonValid(form.lifecycle) && (
          <p className="text-[10px] text-status-error mt-1">Invalid JSON</p>
        )}
      </div>
    </div>
  );
}
