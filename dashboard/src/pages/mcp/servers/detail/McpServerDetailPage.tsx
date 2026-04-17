import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useMcpServer, useCreateMcpServer, useUpdateMcpServer } from '../../../../api/mcp';
import { StepIndicator } from '../../../../components/common/layout/StepIndicator';
import { PageHeader } from '../../../../components/common/layout/PageHeader';
import {
  EMPTY_FORM,
  serverToForm,
  formToPayload,
  STEP_LABELS,
  isStepValid,
} from './server-form-types';
import type { ServerFormState } from './server-form-types';
import { TransportStep } from './TransportStep';
import { DiscoveryStep } from './DiscoveryStep';
import { TestStep } from './TestStep';
import { ReviewStep } from './ReviewStep';

export function McpServerDetailPage() {
  const { serverId } = useParams<{ serverId: string }>();
  const isNew = !serverId;
  const navigate = useNavigate();
  const { data: existing, isLoading } = useMcpServer(serverId ?? '');
  const createServer = useCreateMcpServer();
  const updateServer = useUpdateMcpServer();

  const [form, setForm] = useState<ServerFormState>(EMPTY_FORM);
  const [initialized, setInitialized] = useState(false);
  const [saveError, setSaveError] = useState('');

  // Step via URL search param
  const [searchParams, setSearchParams] = useSearchParams();
  const step = parseInt(searchParams.get('step') || '1', 10);
  const setStep = useCallback((s: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('step', String(s));
      return next;
    }, { replace: false });
  }, [setSearchParams]);

  // Initialize form from existing record
  useEffect(() => {
    if (initialized) return;
    if (isNew) {
      setForm(EMPTY_FORM);
      setInitialized(true);
      return;
    }
    if (existing) {
      setForm(serverToForm(existing));
      setInitialized(true);
    }
  }, [existing, isNew, initialized]);

  const set = (field: keyof ServerFormState, value: any) =>
    setForm((f) => ({ ...f, [field]: value }));

  const isBuiltin = !!(existing?.transport_config as any)?.builtin;

  // Save
  const handleSave = () => {
    setSaveError('');
    const payload = formToPayload(form);

    if (existing) {
      updateServer.mutate(
        { id: existing.id, ...payload },
        { onSuccess: () => navigate('/mcp/servers') },
      );
    } else {
      createServer.mutate(payload, {
        onSuccess: () => navigate('/mcp/servers'),
        onError: (err) => setSaveError(err.message),
      });
    }
  };

  if (!isNew && isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-surface-sunken rounded w-48" />
        <div className="h-60 bg-surface-sunken rounded" />
      </div>
    );
  }

  if (!isNew && !existing && !isLoading) {
    return <p className="text-sm text-text-secondary">Server not found.</p>;
  }

  const isLast = step === STEP_LABELS.length;
  const isPending = createServer.isPending || updateServer.isPending;
  const error = saveError || (createServer.error as Error | null)?.message || (updateServer.error as Error | null)?.message;

  return (
    <div>
      <PageHeader title={isNew ? 'Register MCP Server' : existing?.name ?? ''} />

      <div className="max-w-3xl">
        <StepIndicator steps={STEP_LABELS} currentStep={step - 1} onStepClick={(i) => setStep(i + 1)} />

        <div className="min-h-[360px] py-2">
          {step === 1 && <TransportStep form={form} set={set} isBuiltin={isBuiltin} />}
          {step === 2 && <DiscoveryStep form={form} set={set} />}
          {step === 3 && <TestStep form={form} set={set} />}
          {step === 4 && <ReviewStep form={form} />}
        </div>

        {error && (
          <p className="text-xs text-status-error mt-4">{error}</p>
        )}

        {/* Navigation */}
        <div className="flex justify-between items-center pt-4 border-t border-surface-border mt-4">
          <div>
            {step > 1 && (
              <button onClick={() => setStep(step - 1)} className="btn-secondary text-xs">
                Back
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={() => navigate('/mcp/servers')} className="btn-ghost text-xs">
              Cancel
            </button>
            {isLast ? (
              <button
                onClick={handleSave}
                disabled={!isStepValid(step, form) || isPending}
                className="btn-primary text-xs"
              >
                {isPending ? 'Saving...' : existing ? 'Save' : 'Register'}
              </button>
            ) : (
              <button
                onClick={() => setStep(step + 1)}
                disabled={!isStepValid(step, form)}
                className="btn-primary text-xs"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
