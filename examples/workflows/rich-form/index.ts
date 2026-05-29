/**
 * Rich Form Workflow
 *
 * Showcases every HITL form feature:
 * - format: date, email, textarea, password
 * - x-lt-widget: file-upload, code-editor
 * - x-lt-layout: two-column
 * - x-lt-order for field sequencing
 * - required validation
 * - readOnly display fields
 * - Schema title + description (user mode context panel)
 */

import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import { conditionLT } from '../../../services/orchestrator/condition';
import * as interceptorActivities from '../../../services/interceptor/activities';
import * as activities from './activities';

type InterceptorType = typeof interceptorActivities;
type ActivitiesType = typeof activities;

const LT_ACTIVITY_QUEUE = 'lt-interceptor';

export async function richForm(envelope: LTEnvelope): Promise<any> {
  const { role = 'reviewer' } = envelope.data;

  const { ltCreateEscalation } = Durable.workflow.proxyActivities<InterceptorType>({
    activities: interceptorActivities,
    taskQueue: LT_ACTIVITY_QUEUE,
    retry: { maximumAttempts: 3 },
  });

  const { processIntake } = Durable.workflow.proxyActivities<ActivitiesType>({
    activities,
  });

  const ctx = Durable.workflow.workflowInfo();
  const signalId = `rich-form-${ctx.workflowId}`;

  await ltCreateEscalation({
    type: 'intake',
    subtype: 'rich-form',
    description: 'Complete the customer intake form. Review all fields carefully before submitting.',
    role,
    priority: 2,
    envelope: JSON.stringify(envelope),
    workflowId: ctx.workflowId,
    workflowType: 'richForm',
    taskQueue: ctx.taskQueue,
    metadata: {
      signal_id: signalId,
      form_schema: {
        title: 'Customer Intake',
        description: 'Fill out all required fields for the new customer. Verify the contact email is correct and select the appropriate service tier.',
        'x-lt-layout': 'two-column',
        'x-lt-order': ['customer_name', 'contact_email', 'phone', 'tier', 'start_date', 'budget', 'approved', 'notes', 'attachment'],
        required: ['customer_name', 'contact_email', 'tier', 'start_date', 'approved'],
        properties: {
          customer_name: {
            type: 'string',
            default: '',
            description: 'Full legal business name',
          },
          contact_email: {
            type: 'string',
            format: 'email',
            default: '',
            description: 'Primary contact email address',
          },
          phone: {
            type: 'string',
            default: '',
            description: 'Phone number with country code',
          },
          tier: {
            type: 'string',
            enum: ['free', 'starter', 'professional', 'enterprise'],
            default: 'starter',
            description: 'Service tier determines SLA and feature set',
          },
          start_date: {
            type: 'string',
            format: 'date',
            default: '',
            description: 'Effective start date of the contract',
          },
          budget: {
            type: 'number',
            default: 0,
            description: 'Annual budget in USD',
          },
          approved: {
            type: 'boolean',
            default: false,
            description: 'I confirm all information is accurate',
          },
          notes: {
            type: 'string',
            format: 'textarea',
            default: '',
            description: 'Additional context or special requirements',
            'x-lt-span': 2,
          },
          attachment: {
            type: 'string',
            default: '',
            'x-lt-widget': 'file-upload',
            accept: '.pdf,.doc,.docx,.png,.jpg',
            description: 'Upload signed agreement or supporting documents',
            'x-lt-span': 2,
          },
        },
      },
    },
  });

  const response = await conditionLT<Record<string, unknown>>(signalId);
  const result = await processIntake(response);

  return {
    type: 'return' as const,
    data: result,
  };
}
