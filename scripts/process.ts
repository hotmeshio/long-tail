/**
 * End-to-end process runner for Long Tail examples.
 *
 * Walks Process 3 ("Wrong Language → Durable MCP") through the full
 * escalation chain and MCP triage cycle:
 *
 *   1. Wait for server + seeded escalation
 *   2. Reviewer claims → escalates to admin
 *   3. Admin claims → escalates to engineer
 *   4. Engineer claims → resolves with needsTriage, describes: "Content is in Spanish"
 *   5. LLM-driven MCP triage diagnoses, translates, re-runs workflow, notifies engineering
 *   6. Verify: original workflow completed, engineering escalation created
 *
 * Usage:
 *   npx tsx scripts/process.ts
 *   npx tsx scripts/process.ts --base http://localhost:3000
 */

import { setBase, getBase, log, header, api, login, poll } from './process-helpers';

if (process.argv.includes('--base')) {
  setBase(process.argv[process.argv.indexOf('--base') + 1]);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function run() {
  const BASE = getBase();
  console.log('\n  Long Tail — Process Runner');
  console.log('  ═════════════════════════════════════════════════════════════\n');
  console.log(`  Server: ${BASE}`);

  // ── 0. Wait for server ──────────────────────────────────────────────────

  header('Waiting for server');
  await poll('server ready', async () => {
    try {
      const res = await fetch(`${BASE}/health`);
      return res.ok ? true : null;
    } catch {
      return null;
    }
  }, 60_000, 2_000);
  log('system', 'Server is up');

  // ── 1. Login as all users ───────────────────────────────────────────────

  header('Authentication');
  const reviewerToken = await login('reviewer', 'l0ngt@1l');
  log('reviewer', 'Logged in');
  const adminToken = await login('admin', 'l0ngt@1l');
  log('admin', 'Logged in');
  const engineerToken = await login('engineer', 'l0ngt@1l');
  log('engineer', 'Logged in');

  // ── 2. Wait for Process 3 escalation to appear ──────────────────────────

  header('Process 3 — Wrong Language');
  log('system', 'Waiting for escalation (wrong_language content) ...');

  const escalation: any = await poll('process-3 escalation', async () => {
    const { escalations } = await api(
      'GET',
      '/escalations/available?role=reviewer&limit=50',
      reviewerToken,
    );
    // Find the one with wrong_language flag in the escalation payload
    return escalations.find((e: any) => {
      if (!e.escalation_payload) return false;
      try {
        const payload = typeof e.escalation_payload === 'string'
          ? JSON.parse(e.escalation_payload)
          : e.escalation_payload;
        return payload?.analysis?.flags?.includes('wrong_language');
      } catch {
        return false;
      }
    }) ?? null;
  }, 30_000);

  const originId = escalation.origin_id;
  log('system', `Found escalation ${escalation.id.slice(0, 8)}... (origin: ${originId?.slice(0, 30)}...)`);

  // ── 3. Reviewer: claim → escalate to admin ──────────────────────────────

  header('Step 1 — Reviewer');
  await api('POST', `/escalations/${escalation.id}/claim`, reviewerToken);
  log('reviewer', 'Claimed escalation');

  // Read the escalation details
  const detail = await api('GET', `/escalations/${escalation.id}`, reviewerToken);
  const payloadData = detail.escalation_payload
    ? (typeof detail.escalation_payload === 'string' ? JSON.parse(detail.escalation_payload) : detail.escalation_payload)
    : {};
  log('reviewer', `Content: "${(payloadData.content || '').slice(0, 50)}..."`);
  log('reviewer', `Flags: ${payloadData.analysis?.flags?.join(', ') || 'none'}`);
  log('reviewer', 'This is a language issue — outside my role. Escalating to admin.');

  await api('PATCH', `/escalations/${escalation.id}/escalate`, reviewerToken, {
    targetRole: 'admin',
  });
  log('reviewer', 'Escalated → admin');

  // ── 4. Admin: claim → escalate to engineer ──────────────────────────────

  header('Step 2 — Admin');

  // Poll for the escalation to appear in admin's queue
  const adminEsc: any = await poll('admin escalation', async () => {
    const { escalations } = await api(
      'GET',
      '/escalations/available?role=admin&limit=50',
      adminToken,
    );
    return escalations.find((e: any) => e.id === escalation.id) ?? null;
  });

  await api('POST', `/escalations/${adminEsc.id}/claim`, adminToken);
  log('admin', 'Claimed escalation');
  log('admin', 'Content is in Spanish — needs technical fix. Escalating to engineer.');

  await api('PATCH', `/escalations/${adminEsc.id}/escalate`, adminToken, {
    targetRole: 'engineer',
  });
  log('admin', 'Escalated → engineer');

  // ── 5. Engineer: claim → resolve with needsTriage ───────────────────────

  header('Step 3 — Engineer (MCP Triage)');

  const engEsc: any = await poll('engineer escalation', async () => {
    const { escalations } = await api(
      'GET',
      '/escalations/available?role=engineer&limit=50',
      engineerToken,
    );
    return escalations.find((e: any) => e.id === escalation.id) ?? null;
  });

  await api('POST', `/escalations/${engEsc.id}/claim`, engineerToken);
  log('engineer', 'Claimed escalation');
  log('engineer', 'Content is in the wrong language. Requesting AI triage.');

  const resolveResult = await api('POST', `/escalations/${engEsc.id}/resolve`, engineerToken, {
    resolverPayload: {
      approved: false,
      reason: 'Content is in Spanish — needs translation before review',
      _lt: {
        needsTriage: true,
      },
      notes: 'Content arrived in Spanish. Needs translation to English before it can be reviewed.',
    },
  });

  log('engineer', `Triage started: ${resolveResult.triage ? 'yes' : 'no'} (workflow: ${resolveResult.workflowId?.slice(0, 20)}...)`);

  // ── 6. Wait for triage to complete ──────────────────────────────────────

  header('MCP Triage — Remediation');
  log('system', 'Waiting for triage workflow to translate and re-run ...');

  // Poll the process to see new tasks appear (triage + re-run)
  const processResult: any = await poll('triage completion', async () => {
    const detail = await api('GET', `/tasks/processes/${encodeURIComponent(originId)}`, engineerToken);
    const tasks = detail.tasks || [];
    // Look for a completed reviewContent re-run (from triage)
    const triageTask = tasks.find((t: any) =>
      t.workflow_type === 'mcpTriage' && t.status === 'completed',
    );
    const rerunTask = tasks.find((t: any) =>
      t.workflow_type === 'reviewContent' &&
      t.status === 'completed' &&
      t.created_at > escalation.created_at,
    );
    if (triageTask || rerunTask) return detail;
    return null;
  }, 45_000, 2_000);

  const tasks = processResult.tasks || [];
  const triageTask = tasks.find((t: any) => t.workflow_type?.includes('mcpTriage'));
  const rerunTask = tasks.find((t: any) =>
    t.workflow_type === 'reviewContent' &&
    t.status === 'completed' &&
    t.created_at > escalation.created_at,
  );

  if (triageTask) {
    log('mcp', `Triage workflow: ${triageTask.status}`);
  }
  if (rerunTask) {
    log('mcp', `Re-run workflow: ${rerunTask.status} (translated content auto-approved)`);
  }

  // ── 7. Check for engineering escalation ─────────────────────────────────

  header('Verification');

  // Check engineering escalation created by triage
  const engEscalation: any = await poll('engineering recommendation', async () => {
    const { escalations } = await api(
      'GET',
      '/escalations/available?role=engineer&limit=50',
      engineerToken,
    );
    return escalations.find((e: any) =>
      e.type === 'triage_recommendation' &&
      e.origin_id === originId,
    ) ?? null;
  }, 30_000, 2_000);

  if (engEscalation) {
    log('verify', 'Engineering escalation created by triage');
    log('verify', `Description: ${engEscalation.description?.slice(0, 80)}...`);

    // Claim and acknowledge the notification escalation
    await api('POST', `/escalations/${engEscalation.id}/claim`, engineerToken);
    await api('POST', `/escalations/${engEscalation.id}/resolve`, engineerToken, {
      resolverPayload: { acknowledged: true, note: 'Will add language detection to pipeline' },
    });
    log('engineer', 'Acknowledged recommendation — will add language detection to pipeline');
  }

  // Summary
  const allTasks = tasks;
  const escalations = processResult.escalations || [];

  log('verify', `Process tasks: ${allTasks.length}`);
  log('verify', `Process escalations: ${escalations.length}`);

  header('Process Complete');
  console.log('  The full Durable MCP cycle:');
  console.log('');
  console.log('    Content arrived in Spanish');
  console.log('    → AI flagged (confidence: 0.15, wrong_language)');
  console.log('    → Escalated to reviewer');
  console.log('    → Reviewer escalated to admin (language issue)');
  console.log('    → Admin escalated to engineer (needs technical fix)');
  console.log('    → Engineer requested AI triage (LLM will diagnose and fix)');
  console.log('    → MCP orchestrator: translate_content() → re-invoke workflow');
  console.log('    → Translated content auto-approved');
  console.log('    → Engineering notified: add language detection to pipeline');
  console.log('    → Engineer acknowledged recommendation');
  console.log('');
  console.log('  ═════════════════════════════════════════════════════════════\n');
}

run().catch((err) => {
  console.error(`\n  ✗ ${err.message}\n`);
  process.exit(1);
});
