import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { loggerRegistry } from '../../lib/logger';
import { formSchemaTokenError } from '../../shared/form-validation';
import { registeredToolCount } from '../../services/mcp/registered-tools';
import * as schemaExchange from '../activities/schema-exchange';

const exchangeSchema = z.object({
  endpoint: z.string().optional().describe('Service endpoint URL. Supports template variables resolved by the caller (e.g. /Patient/{id}).'),
  url: z.string().optional().describe('Alias for endpoint (either endpoint or url is required).'),
  method: z.string().describe('HTTP method: GET, POST, PUT, DELETE, PATCH.'),
  headers: z.record(z.string()).optional().describe('Request headers (e.g. Authorization, Accept, Content-Type).'),
  query: z.record(z.string()).optional().describe('Query parameters appended to the URL.'),
  body: z.any().optional().describe('Request body. Validated against request_schema before sending (if provided).'),
  request_schema: z.record(z.any()).optional().describe('JSON Schema for the request body. When provided, the body is validated before the request is sent. Validation failure returns immediately — the request is never made.'),
  response_schema: z.record(z.any()).optional().describe('JSON Schema for the expected response body. When provided, the response is validated after receiving. The validated flag and validation_errors in the output indicate whether the response matched.'),
  timeout_ms: z.number().optional().describe('Request timeout in milliseconds (default: 30000).'),
  credential_provider: z.string().optional().describe('Credential provider name (e.g. "stripe", "epic", "google"). When set, resolves authentication from the connection store using the calling principal\'s identity. No manual token input needed.'),
  credential_label: z.string().optional().describe('Credential label for multi-credential accounts (default: "default").'),
  auth_scheme: z.string().optional().describe('Authentication scheme (default: "Bearer"). Used with credential_provider to build the auth header value.'),
  auth_header: z.string().optional().describe('Header name for the credential (default: "Authorization"). Some APIs use X-API-Key instead.'),
});

const validateSchema = z.object({
  data: z.any().optional().describe('The value to validate against the schema.'),
  schema: z.record(z.any()).optional().describe('JSON Schema to validate against.'),
  form_schema: z.record(z.any()).optional().describe(
    'A resolver form schema to check instead of data: list tokens (pills, rows, x-lt-item-key, x-lt-locate and the rest) are checked as a role save checks them.',
  ),
});

export async function createSchemaExchangeServer(options?: {
  name?: string;
}): Promise<McpServer> {
  const name = options?.name || 'long-tail-schema-exchange';
  const instance = new McpServer({ name, version: '1.0.0' });

  (instance as any).registerTool(
    'exchange',
    {
      title: 'Schema Exchange',
      description:
        'Exchange data with an external service endpoint under schema enforcement. ' +
        'Validates the request body against request_schema before sending and the response ' +
        'body against response_schema after receiving. Transport is an implementation detail — ' +
        'the principle is endpoint + schema + validated data exchange. ' +
        'Use response_schema to detect API drift: schedule on cron and the validated flag ' +
        'tells you immediately when the API shape changes.',
      inputSchema: exchangeSchema,
    },
    async (args: z.infer<typeof exchangeSchema>) => {
      try {
        const result = await schemaExchange.exchange(args);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message }) }], isError: true };
      }
    },
  );

  (instance as any).registerTool(
    'validate_schema',
    {
      title: 'Validate Schema',
      description:
        'Validate any value against a JSON Schema without making a network call. ' +
        'Useful for pre-validating data before storage, checking API response shapes in tests, ' +
        'or verifying that transforms produce correct output. ' +
        'Pass form_schema to check a resolver form schema\'s list tokens instead.',
      inputSchema: validateSchema,
    },
    async (args: z.infer<typeof validateSchema>) => {
      if (args.form_schema) {
        const problem = formSchemaTokenError(args.form_schema);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ valid: problem === null, errors: problem ? [problem] : [] }) }] };
      }
      if (!args.schema) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'schema or form_schema is required' }) }], isError: true };
      }
      const result = schemaExchange.validateSchema(args.data, args.schema);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  loggerRegistry.info(`[lt-mcp:schema-exchange] ${name} ready (${registeredToolCount(instance)} tools registered)`);
  return instance;
}
