import type { ConfigFormState } from './config-form-types';

interface StepProps {
  form: ConfigFormState;
  set: (field: keyof ConfigFormState, value: string | boolean) => void;
}

/**
 * The escalation surface is role-owned: each target role declares its own
 * versioned escalation form. A workflow registers plain and chooses a role when
 * it raises an escalation. This step is informational.
 */
export function AdvancedStep(_props: StepProps) {
  return (
    <div className="py-4 px-4 bg-surface-sunken/50 rounded-md">
      <p className="text-xs text-text-tertiary">
        The escalation surface is <span className="font-medium text-text-secondary">role-owned</span>: each
        target role declares its own versioned <span className="font-mono">form_schema</span> (the JIT UI a
        human fills). Manage it under <span className="font-medium text-text-secondary">Admin → Roles</span>.
        A workflow chooses a role when it raises an escalation; that role's form applies.
      </p>
    </div>
  );
}
