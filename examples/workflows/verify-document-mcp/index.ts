import { Durable } from '@hotmeshio/hotmesh';

import type { LTEnvelope } from '../../../types';
import * as activities from './activities';
import type {
  MemberInfo,
  VerifyDocumentReturn,
  VerifyDocumentEscalation,
  VerifyDocumentReturnData,
  VerifyDocumentEscalationData,
} from '../verify-document/types';

type ActivitiesType = typeof activities;

const {
  listDocumentPages,
  extractMemberInfo,
  validateMember,
} = Durable.workflow.proxyActivities<ActivitiesType>({
  activities,
  retryPolicy: {
    maximumAttempts: 2,
    backoffCoefficient: 2,
    maximumInterval: '10 seconds',
  },
});

/**
 * MCP-native Verify Document workflow.
 *
 * Identical pipeline to workflows/verify-document, but every activity
 * call routes through the Document Vision MCP server via InMemoryTransport.
 * This makes the AI side MCP-native, matching the human escalation side
 * (which already uses the Human Queue MCP server).
 *
 * 1. Lists document pages via MCP tool `list_document_pages`
 * 2. Extracts member info from each page via MCP tool `extract_member_info`
 * 3. Merges multi-page extractions into a single record
 * 4. Validates against the member database via MCP tool `validate_member`
 * 5. If valid → return. If mismatch or extraction failure → escalate.
 */
export async function verifyDocumentMcp(
  envelope: LTEnvelope,
): Promise<VerifyDocumentReturn | VerifyDocumentEscalation> {
  const { documentId } = envelope.data;

  // If this is a re-run with human-provided resolver data, return it
  if (envelope.resolver) {
    return {
      type: 'return',
      milestones: [
        { name: 'extraction', value: 'human_resolved' },
        { name: 'resolved_by_human', value: true },
      ],
      data: {
        documentId,
        ...envelope.resolver,
      } as VerifyDocumentReturnData,
    };
  }

  // Step 1: List pages (MCP tool call)
  const pages = await listDocumentPages();

  // Step 2: Extract info from each page (MCP tool calls)
  const extractions: MemberInfo[] = [];
  for (let i = 0; i < pages.length; i++) {
    const info = await extractMemberInfo(pages[i], i + 1);
    if (info) extractions.push(info);
  }

  if (extractions.length === 0) {
    return {
      type: 'escalation',
      data: {
        documentId,
        extractedInfo: {},
        validationResult: 'extraction_failed',
        reason: 'Vision API could not extract any member information from the document.',
      } satisfies VerifyDocumentEscalationData,
      message: 'Document extraction failed — no data could be read from the images.',
      role: 'reviewer',
    };
  }

  // Step 3: Merge extractions (primary + partial pages)
  const primary = extractions.find(e => !e.isPartialInfo) || extractions[0];
  const merged: MemberInfo = { ...primary };
  for (const partial of extractions.filter(e => e.isPartialInfo)) {
    if (partial.emergencyContact) merged.emergencyContact = partial.emergencyContact;
    if (partial.phone && !merged.phone) merged.phone = partial.phone;
    if (partial.email && !merged.email) merged.email = partial.email;
  }

  // Step 4: Validate (MCP tool call)
  const validation = await validateMember(merged);

  // Step 5: Return or escalate
  if (validation.result === 'match') {
    return {
      type: 'return',
      milestones: [
        { name: 'pages_processed', value: pages.length },
        { name: 'extraction', value: 'success' },
        { name: 'validation', value: 'match' },
      ],
      data: {
        documentId,
        memberId: merged.memberId!,
        extractedInfo: merged,
        validationResult: 'match',
        confidence: 1.0,
      } satisfies VerifyDocumentReturnData,
    };
  }

  // Mismatch or not found → escalate
  const reason =
    validation.result === 'not_found'
      ? `Member ${merged.memberId || '(unknown)'} not found in database.`
      : `Address mismatch for ${merged.memberId}. Extracted: ${JSON.stringify(merged.address)}. Database: ${JSON.stringify(validation.databaseRecord?.address)}.`;

  return {
    type: 'escalation',
    data: {
      documentId,
      extractedInfo: merged,
      validationResult: validation.result,
      databaseRecord: validation.databaseRecord,
      reason,
    } satisfies VerifyDocumentEscalationData,
    message: reason,
    role: 'reviewer',
  };
}
