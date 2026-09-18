// ── Escalation tool manifests ────────────────────────────────────────────────

export const HUMAN_QUEUE_TOOLS = [
  {
    name: 'escalate_to_human',
    description: 'Create a new escalation for human review. Returns the escalation ID.',
    read_safe: false,
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Target role for the escalation (e.g., "reviewer")' },
        message: { type: 'string', description: 'Description of what needs human review' },
        data: { type: 'object', description: 'Contextual data for the reviewer' },
        type: { type: 'string', description: 'Escalation type classification', default: 'mcp' },
        subtype: { type: 'string', description: 'Escalation subtype', default: 'tool_call' },
        priority: { type: 'number', description: 'Priority: 1 (highest) to 4 (lowest)', default: 2 },
      },
      required: ['role', 'message'],
    },
  },
  {
    name: 'check_resolution',
    description: 'Check the status of an escalation. Returns status and resolver payload if resolved.',
    read_safe: true,
    inputSchema: {
      type: 'object',
      properties: {
        escalation_id: { type: 'string', description: 'The escalation ID to check' },
      },
      required: ['escalation_id'],
    },
  },
  {
    name: 'get_escalation_lookups',
    description: 'Resolve the versioned knowledge lookups pinned on an escalation (envelope.lookups). Each ref answers with its immutable edition; a ref whose snapshot does not exist answers with missing: true.',
    read_safe: true,
    inputSchema: {
      type: 'object',
      properties: {
        escalation_id: { type: 'string', description: 'The escalation whose pinned knowledge lookups to resolve' },
      },
      required: ['escalation_id'],
    },
  },
  {
    name: 'get_available_work',
    description: 'List available escalations for a role. Returns pending, unassigned escalations.',
    read_safe: true,
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Role to filter by' },
        limit: { type: 'number', description: 'Max results to return', default: 10 },
      },
      required: ['role'],
    },
  },
  {
    name: 'claim_and_resolve',
    description: 'Claim an escalation and immediately resolve it with a payload. Atomic operation.',
    read_safe: false,
    inputSchema: {
      type: 'object',
      properties: {
        escalation_id: { type: 'string', description: 'The escalation ID to claim and resolve' },
        resolver_id: { type: 'string', description: 'Identifier for who/what is resolving' },
        payload: { type: 'object', description: 'Resolution payload data' },
      },
      required: ['escalation_id', 'resolver_id', 'payload'],
    },
  },
  {
    name: 'resolve_escalation',
    description: 'Resolve an already-claimed escalation with a payload. The payload validates against the role form schema.',
    read_safe: false,
    inputSchema: {
      type: 'object',
      properties: {
        escalation_id: { type: 'string', description: 'The escalation ID to resolve' },
        payload: { type: 'object', description: 'Resolution payload data' },
      },
      required: ['escalation_id', 'payload'],
    },
  },
  {
    name: 'resolve_batch_item',
    description: 'Submit ONE declared item of a batch escalation. Interim items return outcome "accepted" with the count remaining; the LAST item completes the escalation and wakes the waiting workflow with the full collection.',
    read_safe: false,
    inputSchema: {
      type: 'object',
      properties: {
        escalation_id: { type: 'string', description: 'The batch escalation ID' },
        item_key: { type: 'string', description: 'The declared batch item key this submission fills' },
        payload: { type: 'object', description: 'The item payload' },
      },
      required: ['escalation_id', 'item_key', 'payload'],
    },
  },
  {
    name: 'accumulate_item',
    description: 'Add ONE item to an open accumulator escalation. Interim adds return outcome "accepted" with the count held; the add that reaches max completes the escalation and wakes the waiting workflow with the ordered collection. Optionally write a reciprocal row in the same statement.',
    read_safe: false,
    inputSchema: {
      type: 'object',
      properties: {
        escalation_id: { type: 'string', description: 'The accumulator escalation ID (the container)' },
        item_key: { type: 'string', description: 'The key this item is held under' },
        payload: { type: 'object', description: 'Optional item payload, delivered inside $accumulated' },
        reciprocal: { type: 'object', description: 'A second accumulator row written in the same statement, both or neither. Exactly one of id, signalKey, or key/value.', properties: { id: { type: 'string' }, signalKey: { type: 'string' }, key: { type: 'string' }, value: { type: 'string' }, payload: { type: 'object' } } },
      },
      required: ['escalation_id', 'item_key'],
    },
  },
  {
    name: 'remove_item',
    description: 'Remove ONE held item from a pending open accumulator escalation. The row stays pending and the waiting workflow is never woken.',
    read_safe: false,
    inputSchema: {
      type: 'object',
      properties: {
        escalation_id: { type: 'string', description: 'The accumulator escalation ID' },
        item_key: { type: 'string', description: 'The held item key to remove' },
        reciprocal: { type: 'object', description: 'A second accumulator row written in the same statement, both or neither. Exactly one of id, signalKey, or key/value.', properties: { id: { type: 'string' }, signalKey: { type: 'string' }, key: { type: 'string' }, value: { type: 'string' } } },
      },
      required: ['escalation_id', 'item_key'],
    },
  },
  {
    name: 'escalate_and_wait',
    description: 'Create an escalation and pause the workflow until a human responds. Returns a signal ID that the workflow uses to wait durably. Preferred over escalate_to_human + check_resolution polling.',
    read_safe: false,
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Target role for the escalation (e.g., "reviewer")' },
        message: { type: 'string', description: 'Description of what input is needed from the human' },
        form_schema: { type: 'object', description: 'JSON Schema for the resolver form. Use format:"password" for sensitive fields.' },
        data: { type: 'object', description: 'Contextual data for the reviewer' },
        assigned_to: { type: 'string', description: 'Auto-assign to a specific user' },
        type: { type: 'string', description: 'Escalation type classification', default: 'mcp' },
        subtype: { type: 'string', description: 'Escalation subtype', default: 'wait_for_human' },
        priority: { type: 'number', description: 'Priority: 1 (highest) to 4 (lowest)', default: 1 },
      },
      required: ['role', 'message'],
    },
  },
];
