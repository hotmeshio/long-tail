import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useActingIdentity } from '../../hooks/useActingIdentity';
import { SCAN_CHOICES_STATE, useScanInput } from '../../hooks/useScanInput';
import {
  executeScanChoice,
  SCAN_OUTCOMES,
  SCAN_VERBS,
  type ScanExecuteResponse,
  type ScanPresentedChoice,
  type ScanVerb,
} from '../../api/scan-codes';
import {
  StationIdle,
  PrimedChrome,
  InfoChoiceScreen,
  BadgePrompt,
  HoldScreen,
  RefusalPanel,
  ScanBadgePrompt,
  DonePanel,
} from '../../components/scan/station';
import { SimpleMarkdown } from '../../components/common/display/SimpleMarkdown';

const NOTICE_DISMISS_MS = 8_000;

/** Choice verbs whose execution lands the person on the escalation's detail page. */
const DETAIL_VERBS: ScanVerb[] = [
  SCAN_VERBS.SHOW_DETAIL,
  SCAN_VERBS.CLAIM,
  SCAN_VERBS.CLAIM_SHOW_DETAIL,
];

/** Responses from the bench motion (hold, place, refuse); badge scans and choices are not. */
function isBenchResponse(response: ScanExecuteResponse): boolean {
  switch (response.outcome) {
    case SCAN_OUTCOMES.HELD:
    case SCAN_OUTCOMES.REFUSED:
    case SCAN_OUTCOMES.SUBJECT_STALE:
      return true;
    case SCAN_OUTCOMES.NOT_PRIMED:
      return !!response.replayable;
    case SCAN_OUTCOMES.EXECUTED:
      return !!(response.clearSubject || response.progress);
    default:
      return false;
  }
}

interface StationNotice {
  at: number;
  tone: string;
  text: string;
  markdown?: string;
}

/** A choice waiting on a badge, and where Cancel returns. */
interface PendingBadge {
  choice: ScanPresentedChoice;
  returnTo: 'choices' | 'idle';
}

/**
 * The scan station: a full-page surface for badge + item work. Idle until a
 * scan presents an item's reality and choices; a badge scan primes an acting
 * identity that unlocks withheld choices and rides along on executions. A
 * choice that needs a badge first parks in the stop-over (BadgePrompt) — one
 * badge scan primes the identity and the pending choice executes itself.
 * Claim and show choices land on the escalation's detail page for the work.
 */
export function ScanStationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { identity, clear, settle } = useActingIdentity();
  const { lastResult, subject, dropSubject, adoptResponse, pendingScan, dropPendingScan } = useScanInput();
  const [screen, setScreen] = useState<ScanExecuteResponse | null>(null);
  const [pendingBadge, setPendingBadge] = useState<PendingBadge | null>(null);
  const [notice, setNotice] = useState<StationNotice | null>(null);
  const [busy, setBusy] = useState(false);

  // Adopt a CHOICES response arriving in route state, then drop it from
  // history so refresh/back land on the idle station, never a stale reality.
  // An autoSelect response skips the choice screen: the server would have
  // executed its single choice but identity stopped it — straight to the
  // stop-over with that choice pending; Cancel returns to idle.
  useEffect(() => {
    const incoming = (location.state as Record<string, unknown> | null)
      ?.[SCAN_CHOICES_STATE] as ScanExecuteResponse | undefined;
    if (!incoming) return;
    setScreen(incoming);
    setNotice(null);
    const single = incoming.choices?.length === 1 ? incoming.choices[0] : undefined;
    setPendingBadge(incoming.autoSelect && single ? { choice: single, returnTo: 'idle' } : null);
    navigate(location.pathname, { replace: true, state: null });
  }, [location, navigate]);

  // A bench scan (hold, refusal, placed) replaces whatever the station showed.
  const bench = lastResult?.response ?? null;
  const benchAt = lastResult?.at ?? 0;
  useEffect(() => {
    if (!bench || !isBenchResponse(bench)) return;
    setScreen(null);
    setPendingBadge(null);
    setNotice(null);
    if (bench.outcome === SCAN_OUTCOMES.SUBJECT_STALE) {
      setNotice({ at: Date.now(), tone: 'text-status-warning', text: bench.error || 'Scan it again.' });
    }
  }, [bench, benchAt]);

  // Notices self-dismiss — one timeout keyed to the notice.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const executeChoice = useCallback(async (choice: ScanPresentedChoice) => {
    if (!screen?.rule || !screen.escalation) return;
    setBusy(true);
    try {
      const result = await executeScanChoice({
        schemeVersion: screen.rule.schemeVersion,
        category: screen.rule.category,
        stepIndex: screen.stepIndex ?? 0,
        choiceIndex: choice.index,
        escalationId: String(screen.escalation.id),
        actingToken: identity?.actingToken,
      });
      // A claim spends the badge: retire it when the server says none is left.
      if (identity?.actingToken) settle(identity.actingToken, result);
      adoptResponse(result);
      switch (result.outcome) {
        case SCAN_OUTCOMES.HELD:
          setScreen(null);
          setPendingBadge(null);
          break;
        case SCAN_OUTCOMES.EXECUTED:
          setScreen(null);
          setPendingBadge(null);
          if (DETAIL_VERBS.includes(choice.verb) && result.escalation) {
            // The claim (or show) landed — go work the item where it lives.
            navigate(`/escalations/detail/${result.escalation.id}`);
            break;
          }
          // Done — back to idle, ready for the next item.
          setNotice({ at: Date.now(), tone: 'text-status-success', text: `${choice.label} — done` });
          break;
        case SCAN_OUTCOMES.CONFLICT:
          // Someone else won the row; the presented reality is stale.
          setScreen(null);
          setPendingBadge(null);
          setNotice({
            at: Date.now(),
            tone: 'text-status-warning',
            text: result.error || 'The item changed since it was scanned — scan it again.',
          });
          break;
        case SCAN_OUTCOMES.UNCONFIGURED:
          setScreen(null);
          setPendingBadge(null);
          setNotice({
            at: Date.now(),
            tone: 'text-status-warning',
            text: result.error || 'This choice is no longer configured.',
          });
          break;
        case SCAN_OUTCOMES.NOT_PRIMED:
          // The grant died between render and tap — reflect that, then park
          // the choice in the stop-over; the next badge scan satisfies it.
          clear();
          setNotice(null);
          setPendingBadge((prev) => ({ choice, returnTo: prev?.returnTo ?? 'choices' }));
          break;
        default:
          setNotice({
            at: Date.now(),
            tone: 'text-status-error',
            text: result.error || 'The choice did not run.',
          });
      }
    } catch (err: any) {
      setNotice({ at: Date.now(), tone: 'text-status-error', text: err.message });
    } finally {
      setBusy(false);
    }
  }, [screen, identity, navigate, clear, settle, adoptResponse]);

  const holdForBadge = useCallback((choice: ScanPresentedChoice) => {
    setPendingBadge({ choice, returnTo: 'choices' });
  }, []);

  const cancelBadge = useCallback(() => {
    if (pendingBadge?.returnTo === 'idle') setScreen(null);
    setPendingBadge(null);
  }, [pendingBadge]);

  const stationName = user?.displayName || user?.username || 'Scan station';
  const showChoices = !!(screen?.choices && screen.escalation);
  const refusal = bench?.outcome === SCAN_OUTCOMES.REFUSED ? bench : null;
  const executedBench = bench?.outcome === SCAN_OUTCOMES.EXECUTED && isBenchResponse(bench) ? bench : null;
  const progress = subject && executedBench ? executedBench.progress : null;
  const doneMarkdown = executedBench && !subject
    ? executedBench.done?.markdown ?? (executedBench.already ? 'Already there.' : 'Done.')
    : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <PrimedChrome />
      {pendingBadge && screen ? (
        <BadgePrompt
          choice={pendingBadge.choice}
          notPrimedMarkdown={screen.notPrimed?.markdown}
          primed={!!identity}
          busy={busy}
          onExecute={executeChoice}
          onCancel={cancelBadge}
        />
      ) : pendingScan ? (
        <ScanBadgePrompt
          what={subject ? (subject.headline ? `${subject.label} → ${subject.headline}` : subject.label) : null}
          notPrimedMarkdown={bench?.notPrimed?.markdown}
          onCancel={dropPendingScan}
        />
      ) : refusal ? (
        <RefusalPanel
          markdown={refusal.refusal?.markdown ?? refusal.error ?? 'Not placed.'}
          expected={refusal.refusal?.expected}
        />
      ) : subject ? (
        <HoldScreen
          subject={subject}
          primedName={identity?.displayName ?? null}
          progress={progress}
          progressLabel={executedBench?.verb === SCAN_VERBS.ACCUMULATE ? 'added' : 'checked off'}
          note={subject && executedBench ? executedBench.done?.markdown ?? null : null}
          onRelease={dropSubject}
        />
      ) : doneMarkdown ? (
        <DonePanel key={benchAt} markdown={doneMarkdown} nextPrompt="Scan the next item" />
      ) : showChoices ? (
        <InfoChoiceScreen
          key={String(screen!.escalation!.id)}
          response={screen!}
          hasActingIdentity={!!identity}
          selfId={identity?.actorId ?? user?.userId ?? null}
          busy={busy}
          onExecute={executeChoice}
          onWithheldSelect={holdForBadge}
        />
      ) : (
        <StationIdle stationName={stationName} primedName={identity?.displayName ?? null} />
      )}
      {notice && (
        <div role="status" className="mt-8 pt-3 border-t border-surface-border">
          <span className={`text-sm font-medium ${notice.tone}`}>{notice.text}</span>
          {notice.markdown && (
            <div className="text-sm text-text-secondary mt-1">
              <SimpleMarkdown content={notice.markdown} compact />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
