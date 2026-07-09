/**
 * printerTwin — the digital twin of one physical machine. Its entire life is a
 * while loop over `condition()` waits, and each wait IS an escalation: the JIT
 * UI the twin presents to whoever must act next.
 *
 *   registering → a print-servicer unboxes the machine, joins it to the farm
 *                 manager, and records its identity (the registration form)
 *   ready       → an availability advert carrying the capability facets; the
 *                 broker resolves it with a job (or a powerdown command)
 *   printing    → the physical rendezvous — the farm manager's callback
 *                 resolves it when the machine reports (the mock backend plays
 *                 this part until the real host is wired up)
 *   service     → any CANCELLED wait (power outage, machine dark mid-print)
 *                 detours here; a servicer realigns machine and twin, then
 *                 submits, and the twin re-enters the pool
 *
 * The loop is unbounded (a machine lives for years), so history is bounded by
 * continueAsNew every LOOPS_PER_GENERATION iterations — identity, counters,
 * and the wait sequence carry forward in the envelope.
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../../types';

import { reportPrintOutcome } from './proxy';
import { normalizeRegistration, twinAdvertFacets } from '../policy';
import { REGISTRATION_FORM_SCHEMA, SERVICE_FORM_SCHEMA } from '../forms';
import {
  PRINT_SERVICER,
  PRINTER_FLEET,
  TWIN_WORKFLOWS,
  TWIN_STATE,
  TWIN_FACETS,
  LOOPS_PER_GENERATION,
} from '../types';
import type {
  TwinData,
  TwinResult,
  TwinRegistration,
  TwinJobPayload,
  TwinServicePayload,
  PrintDonePayload,
} from '../types';

export async function printerTwin(envelope: LTEnvelope): Promise<any> {
  const d = envelope.data as TwinData;
  if (!d.printerId) throw new Error('printerTwin requires data.printerId');
  if (!d.operatorId) throw new Error('printerTwin requires data.operatorId (a fleet pond operator)');
  const ctx = Durable.workflow.workflowInfo();

  let registration: TwinRegistration | undefined = d.registration;
  let jobsCompleted = d.jobsCompleted ?? 0;
  let services = d.services ?? 0;
  let seq = d.seq ?? 0;
  let powerdown = false;

  // A cancelled wait means the physical machine fell out of alignment with its
  // twin — raise a service escalation and park until a servicer restores it.
  const awaitService = async (reason: string): Promise<void> => {
    const svc = await Durable.workflow.condition<TwinServicePayload>(
      `service-${ctx.workflowId}-s${seq++}`,
      {
        role: PRINT_SERVICER,
        type: TWIN_WORKFLOWS.TWIN,
        subtype: TWIN_STATE.SERVICE,
        priority: 1,
        description: `Printer ${d.printerId} needs service — ${reason}`,
        workflowType: TWIN_WORKFLOWS.TWIN,
        metadata: {
          [TWIN_FACETS.PRINTER_ID]: d.printerId,
          [TWIN_FACETS.SERIAL_NUMBER]: registration?.serialNumber ?? '',
          [TWIN_FACETS.STATE]: TWIN_STATE.SERVICE,
          form_schema: SERVICE_FORM_SCHEMA,
        },
        envelope: { printerId: d.printerId, reason },
      },
    );
    services += 1;
    if (svc && svc.filamentLoaded && registration) {
      registration = { ...registration, filament: svc.filamentLoaded };
    }
  };

  for (let loop = 0; loop < LOOPS_PER_GENERATION && !powerdown; loop++) {
    // 1. Unregistered — ask a print-servicer to bring the machine online and
    //    describe it. The resolved form IS the twin's identity from here on.
    if (!registration) {
      const reg = await Durable.workflow.condition<Record<string, unknown>>(
        `register-${ctx.workflowId}-s${seq++}`,
        {
          role: PRINT_SERVICER,
          type: TWIN_WORKFLOWS.TWIN,
          subtype: TWIN_STATE.REGISTERING,
          priority: 1,
          description: `Register printer ${d.printerId}: plug it in, connect it to the farm manager, then record its identity`,
          workflowType: TWIN_WORKFLOWS.TWIN,
          metadata: {
            [TWIN_FACETS.PRINTER_ID]: d.printerId,
            [TWIN_FACETS.STATE]: TWIN_STATE.REGISTERING,
            form_schema: REGISTRATION_FORM_SCHEMA,
          },
          envelope: { printerId: d.printerId },
        },
      );
      // Cancelled or empty → ask again next loop; the machine is not on the floor yet.
      if (reg && !reg.__escalation_cancelled) registration = normalizeRegistration(reg);
      continue;
    }

    const facets = twinAdvertFacets(d.printerId, registration);

    // 2. Ready — advertise availability with the capability facets. The broker
    //    claims printer sets against these rows and resolves each with its job.
    const job = await Durable.workflow.condition<TwinJobPayload>(
      `ready-${ctx.workflowId}-s${seq++}`,
      {
        role: PRINTER_FLEET,
        type: TWIN_WORKFLOWS.TWIN,
        subtype: TWIN_STATE.READY,
        priority: 2,
        description: `Printer ${d.printerId} (${registration.model}) available to print`,
        workflowType: TWIN_WORKFLOWS.TWIN,
        metadata: { ...facets, [TWIN_FACETS.STATE]: TWIN_STATE.READY },
        envelope: { printerId: d.printerId, serialNumber: registration.serialNumber },
      },
    );

    // Advert cancelled → the machine was taken offline while idle (power
    // outage, unplugged). Service before re-entering the pool.
    if (!job || job.__escalation_cancelled) {
      await awaitService('availability advert was cancelled');
      continue;
    }
    if (job.powerdown) { powerdown = true; break; }

    // 3. Printing — the physical rendezvous row. The broker has told the farm
    //    manager to print; the farm manager's callback resolves this row when
    //    the machine reports. Row created_at → resolved_at IS the print duration.
    const done = await Durable.workflow.condition<PrintDonePayload>(job.printDoneKey, {
      role: PRINTER_FLEET,
      type: TWIN_WORKFLOWS.TWIN,
      subtype: TWIN_STATE.PRINTING,
      priority: 2,
      description: `Printer ${d.printerId} printing job ${job.jobId} (order ${job.orderId})`,
      workflowType: TWIN_WORKFLOWS.TWIN,
      metadata: {
        ...facets,
        [TWIN_FACETS.STATE]: TWIN_STATE.PRINTING,
        jobId: job.jobId,
        orderId: job.orderId,
      },
      envelope: { printerId: d.printerId, jobId: job.jobId, gcodeUrl: job.gcodeUrl },
    });

    // A cancelled printing row is the dead-machine path: the machine went dark
    // mid-print and a farm worker cancelled the row from the dashboard.
    const wentDark = !done || done.__escalation_cancelled === true;

    // 4. Report to the broker either way — a cancel outcome returns the unit
    //    to the funnel; the order sees it and the next phase handles reprints.
    await reportPrintOutcome({
      callbackKey: job.callbackKey,
      outcome: wentDark ? 'cancel' : done.outcome,
      printerId: d.printerId,
      jobId: job.jobId,
      orderId: job.orderId,
      unitIndex: job.unitIndex,
      operatorId: d.operatorId,
    });

    if (wentDark) {
      await awaitService(`print job ${job.jobId} was cancelled mid-print`);
      continue;
    }
    jobsCompleted += 1;
  }

  if (powerdown) {
    const result: TwinResult = { printerId: d.printerId, retired: true, jobsCompleted, services };
    return { type: 'return' as const, data: result };
  }

  // Bound the history; the twin's identity and counters ride the envelope.
  const nextEnvelope: LTEnvelope = {
    data: { ...d, registration, jobsCompleted, services, seq },
    metadata: envelope.metadata ?? {},
  };
  await Durable.workflow.continueAsNew(nextEnvelope);
}
