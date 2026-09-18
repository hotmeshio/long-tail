import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, HelpCircle } from 'lucide-react';
import { SlidePanelViews, type SlidePanelView } from '../../../components/common/layout/SlidePanel';
import { MarkdownRenderer } from '../../../components/common/display/MarkdownRenderer';
import { ErrorsPanel } from '../../../components/escalation/ErrorsPanel';
import { useShellPanelOptional } from '../../../hooks/useShellPanel';
import { buildHelpMarkdown } from '../../../lib/x-lt-help';
import type { ShowIfContext } from '../../../lib/x-lt-show-if';
import type { FieldError } from '../../../lib/field-validator';

export const INVOKE_PANEL_KEY = 'invoke-help';
const PANEL_WIDTH = 380;

export const INVOKE_PANEL_VIEWS = {
  INSTRUCTIONS: 'instructions',
  ISSUES: 'issues',
} as const;
type InvokePanelView = (typeof INVOKE_PANEL_VIEWS)[keyof typeof INVOKE_PANEL_VIEWS];

function InvokePanelContent({
  view,
  onViewChange,
  onClose,
  helpMarkdown,
  errors,
  schema,
}: {
  view: InvokePanelView;
  onViewChange: (v: InvokePanelView) => void;
  onClose: () => void;
  helpMarkdown: string | null;
  errors: FieldError[];
  schema: Record<string, unknown>;
}) {
  const views: SlidePanelView[] = [];
  if (helpMarkdown) {
    views.push({
      id: INVOKE_PANEL_VIEWS.INSTRUCTIONS,
      icon: HelpCircle,
      label: 'Instructions',
      content: <MarkdownRenderer content={helpMarkdown} />,
    });
  }
  views.push({
    id: INVOKE_PANEL_VIEWS.ISSUES,
    icon: AlertCircle,
    label: 'Issues',
    content: <ErrorsPanel errors={errors} schema={schema} />,
  });
  const activeId = views.some((v) => v.id === view) ? view : views[0].id;
  return (
    <SlidePanelViews
      views={views}
      activeId={activeId}
      onViewChange={(id) => onViewChange(id as InvokePanelView)}
      onClose={onClose}
      stickyClassName="h-full min-h-0"
      labelInline
    />
  );
}

/**
 * The invoke form's side panel in the shell's right slot: Instructions
 * (x-lt-help, re-interpolated against the live values) and Issues (the
 * current violations, click-to-focus). Content follows the form while the
 * panel is open; the slot is released on unmount. A host that cannot use the
 * slot (a dialog over the shell) passes `enabled: false` and renders the same
 * content inline; the hook then never claims the slot.
 */
export function useInvokeSidePanel({
  schema,
  context,
  errors,
  enabled = true,
}: {
  schema: Record<string, unknown>;
  context: ShowIfContext;
  errors: FieldError[];
  enabled?: boolean;
}) {
  const shell = useShellPanelOptional();
  // The provider's callbacks are stable; the context object is not.
  const setPanel = enabled ? shell?.setPanel : undefined;
  const closePanel = enabled ? shell?.closePanel : undefined;
  const ownerKey = shell?.ownerKey ?? null;
  const slotOpen = shell?.open ?? false;
  const [view, setView] = useState<InvokePanelView | null>(null);

  const helpMarkdown = useMemo(() => buildHelpMarkdown(schema, context), [schema, context]);

  const close = useCallback(() => {
    setView(null);
    closePanel?.(INVOKE_PANEL_KEY);
  }, [closePanel]);

  useEffect(() => {
    if (!setPanel || !view) return;
    setPanel(
      <InvokePanelContent
        view={view}
        onViewChange={setView}
        onClose={close}
        helpMarkdown={helpMarkdown}
        errors={errors}
        schema={schema}
      />,
      { key: INVOKE_PANEL_KEY, width: PANEL_WIDTH },
    );
  }, [setPanel, view, helpMarkdown, errors, schema, close]);

  // Another claimant taking the slot ends our view.
  useEffect(() => {
    if (view && slotOpen && ownerKey && ownerKey !== INVOKE_PANEL_KEY) setView(null);
  }, [view, slotOpen, ownerKey]);

  const closeRef = useRef(closePanel);
  closeRef.current = closePanel;
  useEffect(() => () => { closeRef.current?.(INVOKE_PANEL_KEY); }, []);

  return {
    helpMarkdown,
    hasInstructions: !!helpMarkdown,
    open: view !== null,
    showInstructions: () => setView(INVOKE_PANEL_VIEWS.INSTRUCTIONS),
    showIssues: () => setView(INVOKE_PANEL_VIEWS.ISSUES),
    close,
  };
}
