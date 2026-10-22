import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useEscalation } from '../../../api/escalations';
import { useEscalationDetailEvents } from '../../../hooks/useEventHooks';
import { RosterWidget } from '../../escalation/widgets/RosterWidget';
import { X_LT_ACTIONS } from '../../../lib/x-lt-actions';
import { rosterRowContext } from '../../../lib/x-lt-roster';

/**
 * The held row's roster under the hold card: the field `hold.show` names on
 * the row's form, read-only, refreshed on the row's own events and after
 * each scan the station makes, so each fill ticks its entry in while the
 * scan motion continues.
 */
export function HeldRoster({ escalationId, field, refreshKey }: {
  escalationId: string;
  field: string;
  /** Changes on every bench response; the roster refetches once per change. */
  refreshKey: number;
}) {
  const queryClient = useQueryClient();
  const { data: esc } = useEscalation(escalationId);
  useEscalationDetailEvents(escalationId);

  useEffect(() => {
    if (refreshKey) void queryClient.invalidateQueries({ queryKey: ['escalations', escalationId] });
  }, [refreshKey, escalationId, queryClient]);

  const schema = useMemo(() => {
    const record = esc as unknown as Record<string, any> | undefined;
    const form = record?.metadata?.form_schema ?? record?.form_schema;
    const fieldSchema = form?.properties?.[field] as Record<string, unknown> | undefined;
    if (!fieldSchema) return null;
    const { [X_LT_ACTIONS]: _actions, ...readOnly } = fieldSchema;
    return readOnly;
  }, [esc, field]);

  if (!esc || !schema) return null;
  return (
    <div className="w-full max-w-2xl mt-8 text-left" data-testid="held-roster">
      <RosterWidget
        fieldKey={field}
        value=""
        onChange={() => {}}
        schema={schema}
        escalationContext={rosterRowContext(esc as unknown as Record<string, unknown>)}
      />
    </div>
  );
}
