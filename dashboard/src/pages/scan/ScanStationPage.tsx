import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useActingIdentity } from '../../hooks/useActingIdentity';
import { useViewerIdentity } from '../../hooks/useViewerIdentity';
import { kioskHomePath, useKioskMode } from '../../hooks/useKioskMode';
import { useEventSubscriptions } from '../../hooks/useEventContext';
import { SCAN_CHOICES_STATE, useScanInput } from '../../hooks/useScanInput';
import { useRoleDetails } from '../../api/roles';
import { escalationPatterns } from '../../lib/events/subjects';
import { readScanDone, resolveScanDoneReturn } from '../../lib/scan-done';
import { portalsOf } from '../../lib/portal-path';
import { facetHolds } from '../../../../shared/scan-code';
import {
  executeScanChoice,
  SCAN_OUTCOMES,
  SCAN_VERBS,
  type ScanExecuteResponse,
  type ScanFollow,
  type ScanOpenLink,
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
      return !!(response.clearSubject || response.progress || response.done);
    default:
      return false;
  }
}

/** A completed act's copy, shown large until the station moves on, and the role of the row it completed. */
interface DoneScreen {
  at: number;
  markdown: string;
  role?: string;
  /** The act's own pause before the station returns. */
  afterSeconds?: number;
  /** The line under the copy. */
  nextPrompt?: string;
  open?: ScanOpenLink;
}

const NEXT_PROMPT_DEFAULT = 'Scan the next item';

/** The station waiting for the completed subject's next row. */
interface Following {
  at: number;
  follow: ScanFollow;
  markdown: string;
  role?: string;
}

interface StationNotice {
  at: number;
  tone: string;
  text: string;
  markdown?: string;
}

/** A choice waiting on a badge, where Cancel returns, and why the last badge did not run it. */
interface PendingBadge {
  choice: ScanPresentedChoice;
  returnTo: 'choices' | 'idle';
  message?: string;
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
  const { viewerId } = useViewerIdentity();
  const { lastResult, subject, dropSubject, adoptResponse, followCode, pendingScan, dropPendingScan } = useScanInput();
  const kiosk = useKioskMode();
  const { data: roleDetails } = useRoleDetails();
  const [screen, setScreen] = useState<ScanExecuteResponse | null>(null);
  const [pendingBadge, setPendingBadge] = useState<PendingBadge | null>(null);
  const [notice, setNotice] = useState<StationNotice | null>(null);
  const [actDone, setActDone] = useState<DoneScreen | null>(null);
  const [following, setFollowing] = useState<Following | null>(null);
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
    setActDone(null);
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
    setActDone(null);
    if (bench.outcome === SCAN_OUTCOMES.SUBJECT_STALE) {
      setNotice({ at: Date.now(), tone: 'text-status-warning', text: bench.error || 'Scan it again.' });
    }
    // A completing act that names the subject's next step: wait for that row.
    if (bench.outcome === SCAN_OUTCOMES.EXECUTED && bench.follow) {
      setFollowing({ at: benchAt, follow: bench.follow, markdown: bench.done?.markdown ?? 'Done.', role: bench.escalation?.role });
    }
  }, [bench, benchAt]);

  // Following ends the moment a hold lands (the next row is held) or a new scan arrives.
  useEffect(() => {
    if (!following) return;
    if (subject || (bench && benchAt > following.at && bench.outcome !== SCAN_OUTCOMES.NO_MATCH_FALLBACK)) {
      setFollowing(null);
    }
  }, [following, subject, bench, benchAt]);

  // A hold that lands while an act's copy is up replaces it.
  useEffect(() => {
    if (subject) setActDone(null);
  }, [subject]);

  // The next row announces itself: a created event in one of the follow roles
  // for the same target replays the held code, and the hold lands.
  const followPatterns = useMemo(
    () => (following ? following.follow.roles.flatMap((role) => escalationPatterns({ role, verbs: ['created'] })) : []),
    [following],
  );
  useEventSubscriptions(followPatterns, (event: any) => {
    if (!following) return;
    const { facet, value } = following.follow.target;
    const meta = event?.data?.metadata;
    if (meta && typeof meta === 'object' && meta[facet] !== undefined && !facetHolds(meta[facet], value)) return;
    void followCode(following.follow.code);
  });

  // Nothing arrived in time: one last look. A row found then is held; otherwise
  // the completed act's copy stands on its own, since the replay's answer took the bench.
  useEffect(() => {
    if (!following) return;
    const remaining = following.at + following.follow.waitSeconds * 1000 - Date.now();
    const timer = setTimeout(async () => {
      const held = await followCode(following.follow.code);
      if (!held) setActDone({ at: Date.now(), markdown: following.markdown, role: following.role });
      setFollowing((current) => (current?.at === following.at ? null : current));
    }, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [following, followCode]);

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
          if (result.done) {
            // The choice's own done copy takes the screen, badge first or second.
            setActDone({ at: Date.now(), ...result.done, role: result.escalation?.role, open: result.open });
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
          // The grant died between render and tap, or the choice needs a role
          // the person acting lacks: park it; the next badge scan satisfies it.
          clear();
          setNotice(null);
          setPendingBadge((prev) => ({
            choice,
            returnTo: prev?.returnTo ?? 'choices',
            ...(choice.roles?.length && result.error ? { message: result.error } : {}),
          }));
          break;
        case SCAN_OUTCOMES.REFUSED:
          // A badge without the choice's role: drop it and wait for one that has it.
          clear();
          setNotice(null);
          setPendingBadge((prev) => ({
            choice,
            returnTo: prev?.returnTo ?? 'choices',
            message: result.refusal?.markdown ?? result.error ?? 'That badge cannot do this.',
          }));
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
  const benchDone: DoneScreen | null = executedBench && !subject
    ? {
        at: benchAt,
        ...executedBench.done,
        markdown: executedBench.done?.markdown ?? (executedBench.already ? 'Already there.' : 'Done.'),
        role: executedBench.escalation?.role,
        open: executedBench.open,
      }
    : null;
  const done = actDone && (!benchDone || actDone.at > benchDone.at) ? actDone : benchDone;

  // Where the station returns: the chosen queue's policy, else the completed row's role.
  const completedRole = done?.role;
  const doneAfterSeconds = done?.afterSeconds;
  const scanDone = useMemo(() => {
    const detailOf = (role: string | null | undefined) => (role ? roleDetails?.roles?.find((r) => r.role === role) : undefined);
    const completed = detailOf(completedRole);
    return resolveScanDoneReturn(
      { policy: readScanDone(detailOf(kiosk.role)?.properties), homePath: kiosk.homePath },
      completed ? { policy: readScanDone(completed.properties), homePath: kioskHomePath(completed.role, portalsOf(completed)) } : null,
      doneAfterSeconds,
    );
  }, [kiosk.role, kiosk.homePath, completedRole, doneAfterSeconds, roleDetails]);

  // The row is complete, nothing is held and the station is not following: return per the policy.
  const [returnAt, setReturnAt] = useState<number | null>(null);
  useEffect(() => {
    if (!done || following || subject || !scanDone) {
      setReturnAt(null);
      return;
    }
    setReturnAt(Date.now() + scanDone.afterMs);
    const timer = setTimeout(() => navigate(scanDone.path), scanDone.afterMs);
    return () => clearTimeout(timer);
  }, [done, following, subject, scanDone, navigate]);

  // The hold's own release: let go, then go where the rule says.
  const releaseSubject = useCallback(() => {
    const target = subject?.release?.return;
    dropSubject();
    const path = target === 'home' ? kiosk.homePath : target;
    if (path) navigate(path);
  }, [subject, dropSubject, kiosk.homePath, navigate]);

  // Every entry on the held roster is in: the hold ends on its done copy.
  const completeHold = useCallback(() => {
    const copy = subject?.whenAllIn;
    if (!copy) return;
    dropSubject();
    setActDone({ at: Date.now(), ...copy });
  }, [subject, dropSubject]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <PrimedChrome />
      {pendingBadge && screen ? (
        <BadgePrompt
          choice={pendingBadge.choice}
          notPrimedMarkdown={screen.notPrimed?.markdown}
          message={pendingBadge.message}
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
      ) : refusal && !subject?.show ? (
        <RefusalPanel
          markdown={refusal.refusal?.markdown ?? refusal.error ?? 'Not placed.'}
          expected={refusal.refusal?.expected}
          open={refusal.open}
        />
      ) : subject ? (
        <HoldScreen
          subject={subject}
          primedName={identity?.displayName ?? null}
          progress={progress}
          progressLabel={executedBench?.verb === SCAN_VERBS.ACCUMULATE ? 'added' : 'checked off'}
          note={subject && executedBench ? executedBench.done?.markdown ?? null : null}
          refusal={refusal ? {
            markdown: refusal.refusal?.markdown ?? refusal.error ?? 'Not placed.',
            expected: refusal.refusal?.expected,
            open: refusal.open,
          } : null}
          refreshKey={benchAt}
          onRelease={releaseSubject}
          onOpen={dropSubject}
          onAllIn={completeHold}
        />
      ) : following ? (
        <DonePanel key={following.at} markdown={following.markdown} nextPrompt="Finding its next step" />
      ) : done ? (
        <DonePanel
          key={done.at}
          markdown={done.markdown}
          nextPrompt={done.nextPrompt ?? NEXT_PROMPT_DEFAULT}
          open={done.open}
          returning={returnAt && scanDone
            ? { at: returnAt, button: scanDone.button, onReturn: () => navigate(scanDone.path) }
            : null}
        />
      ) : showChoices ? (
        <InfoChoiceScreen
          key={String(screen!.escalation!.id)}
          response={screen!}
          hasActingIdentity={!!identity}
          selfId={viewerId ?? null}
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
