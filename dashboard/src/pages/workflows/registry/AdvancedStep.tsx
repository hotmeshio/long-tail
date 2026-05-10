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

function csvToArray(csv: string): string[] {
  return splitCsv(csv);
}

function arrayToCsv(arr: string[]): string {
  return arr.join(', ');
}

export function AdvancedStep({ form, set }: StepProps) {
  const { data: configs } = useWorkflowConfigs();
  const consumesOptions = (configs ?? [])
    .map((c) => c.workflow_type)
    .filter((t) => t !== form.workflow_type);

  return (
    <div className="space-y-5">
      {/* Resolver Schema — always available */}
      <div>
        <label className={labelCls}>Resolver Schema</label>
        <textarea
          value={form.resolver_schema}
          onChange={(e) => set('resolver_schema', e.target.value)}
          placeholder={`{\n  "properties": {\n    "approved": { "type": "boolean", "default": false, "description": "Approve?" },\n    "notes": { "type": "string", "default": "", "description": "Reviewer notes" }\n  }\n}`}
          className={jsonCls}
          rows={8}
          spellCheck={false}
        />
        <p className={hintCls}>
          Default form template for resolving escalations from this workflow.
          Use <span className="font-mono">properties</span> with <span className="font-mono">type</span>, <span className="font-mono">default</span>, <span className="font-mono">description</span>, <span className="font-mono">enum</span>, and <span className="font-mono">format</span> for typed form fields.
        </p>
        {form.resolver_schema.trim() && !jsonValid(form.resolver_schema) && (
          <p className="text-[10px] text-status-error mt-1">Invalid JSON</p>
        )}
      </div>

      {/* Certify toggle */}
      <div className="flex gap-6 pt-1">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.certified}
            onChange={(e) => set('certified', e.target.checked)}
            className="w-4 h-4 rounded border-border accent-accent"
          />
          <span className="text-xs text-text-primary font-medium">Certify for HITL Escalation</span>
        </label>
      </div>
      <p className={hintCls}>
        Certified workflows use the interceptor to wrap executions — failures
        escalate to human reviewers instead of throwing.
      </p>

      {form.certified ? (
        <>
          {/* Default Escalation Role */}
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

          {/* Escalation Roles */}
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

          {/* Consumes */}
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
        </>
      ) : (
        <div className="py-4 px-4 bg-surface-sunken/50 rounded-md text-center">
          <p className="text-xs text-text-tertiary">
            This workflow will run as standard durable without the interceptor.
            Enable{' '}
            <span className="font-medium text-text-secondary">
              Certify for HITL Escalation
            </span>{' '}
            to add automatic escalation routing and role-based resolution.
          </p>
        </div>
      )}
    </div>
  );
}
