/**
 * Persona management tools — mirrors routes/personas.ts plus the persona
 * sub-routes on routes/users.ts. A persona is a named bundle of roles with a
 * per-role relationship scope; assigning one fans out to ordinary scoped role
 * memberships (lt_user_roles stays the single source of authorization truth).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as personaService from '../../../services/persona';
import {
  listPersonasSchema,
  getPersonaSchema,
  createPersonaSchema,
  updatePersonaSchema,
  deletePersonaSchema,
  linkPersonaRoleSchema,
  unlinkPersonaRoleSchema,
  assignPersonaSchema,
  unassignPersonaSchema,
  getUserPersonasSchema,
} from './schemas';

const PERSONA_KEY = /^[a-z][a-z0-9_-]*$/;

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  };
}

export function registerPersonaTools(server: McpServer): void {

  // mirrors GET /api/personas
  (server as any).registerTool(
    'list_personas',
    {
      title: 'List Personas',
      description:
        'List all personas — named role bundles with per-role relationship ' +
        'scope — with their role links and holder counts.',
      inputSchema: listPersonasSchema,
    },
    async (_args: z.infer<typeof listPersonasSchema>) => {
      const personas = await personaService.listPersonas();
      return jsonResult({ personas });
    },
  );

  // mirrors GET /api/personas/:key
  (server as any).registerTool(
    'get_persona',
    {
      title: 'Get Persona',
      description: 'Fetch one persona with its role links and current assignees.',
      inputSchema: getPersonaSchema,
    },
    async (args: z.infer<typeof getPersonaSchema>) => {
      const persona = await personaService.getPersona(args.key);
      if (!persona) return errorResult(`Persona '${args.key}' not found`);
      return jsonResult(persona);
    },
  );

  // mirrors POST /api/personas
  (server as any).registerTool(
    'create_persona',
    {
      title: 'Create Persona',
      description:
        'Create a persona. Link roles with link_persona_role, then assign ' +
        'users with assign_persona.',
      inputSchema: createPersonaSchema,
    },
    async (args: z.infer<typeof createPersonaSchema>) => {
      const key = args.key.trim().toLowerCase();
      if (!PERSONA_KEY.test(key)) {
        return errorResult('key must start with a letter and contain only lowercase letters, numbers, hyphens, and underscores');
      }
      const persona = await personaService.createPersona({
        key,
        title: args.title,
        description: args.description,
      });
      return jsonResult(persona);
    },
  );

  // mirrors PATCH /api/personas/:key
  (server as any).registerTool(
    'update_persona',
    {
      title: 'Update Persona',
      description: 'Update a persona\'s title/description with PATCH semantics — omitted fields keep their values; null clears.',
      inputSchema: updatePersonaSchema,
    },
    async (args: z.infer<typeof updatePersonaSchema>) => {
      const persona = await personaService.updatePersona(args.key, {
        title: args.title,
        description: args.description,
      });
      if (!persona) return errorResult(`Persona '${args.key}' not found`);
      return jsonResult(persona);
    },
  );

  // mirrors DELETE /api/personas/:key
  (server as any).registerTool(
    'delete_persona',
    {
      title: 'Delete Persona',
      description:
        'Delete a persona. Memberships it sustains are removed (or re-homed ' +
        'to a sibling persona the user still holds); direct grants are never touched.',
      inputSchema: deletePersonaSchema,
    },
    async (args: z.infer<typeof deletePersonaSchema>) => {
      const result = await personaService.deletePersona(args.key);
      if (!result.deleted) return errorResult(`Persona '${args.key}' not found`);
      return jsonResult({ deleted: true, recompute: result.recompute });
    },
  );

  // mirrors PUT /api/personas/:key/roles/:role
  (server as any).registerTool(
    'link_persona_role',
    {
      title: 'Link Persona Role',
      description:
        'Link a role to a persona (or change the link\'s relationship). Every ' +
        'current holder\'s memberships are reconciled in the same transaction.',
      inputSchema: linkPersonaRoleSchema,
    },
    async (args: z.infer<typeof linkPersonaRoleSchema>) => {
      const relationship = personaService.normalizeRelationship(args.relationship);
      if (!relationship) {
        return errorResult('relationship must be write-all, write-self, or read-all (write-none is accepted as read-all)');
      }
      const result = await personaService.linkPersonaRole(args.key, args.role.trim().toLowerCase(), relationship);
      if (!result) return errorResult(`Persona '${args.key}' not found`);
      return jsonResult(result);
    },
  );

  // mirrors DELETE /api/personas/:key/roles/:role
  (server as any).registerTool(
    'unlink_persona_role',
    {
      title: 'Unlink Persona Role',
      description: 'Remove a role link from a persona and reconcile every holder\'s memberships.',
      inputSchema: unlinkPersonaRoleSchema,
    },
    async (args: z.infer<typeof unlinkPersonaRoleSchema>) => {
      const result = await personaService.unlinkPersonaRole(args.key, args.role);
      if (!result.personaFound) return errorResult(`Persona '${args.key}' not found`);
      if (!result.unlinked) return errorResult(`Persona '${args.key}' does not link role '${args.role}'`);
      return jsonResult({ unlinked: true, recompute: result.recompute });
    },
  );

  // mirrors POST /api/users/:id/personas
  (server as any).registerTool(
    'assign_persona',
    {
      title: 'Assign Persona',
      description:
        'Assign a persona to a user — shorthand for adding the user to each ' +
        'linked role at the linked scope. Idempotent: re-assigning overlays ' +
        'fresh from the persona\'s current links. Highest allowance wins when ' +
        'bundles overlap; direct grants are only ever raised, never lowered.',
      inputSchema: assignPersonaSchema,
    },
    async (args: z.infer<typeof assignPersonaSchema>) => {
      const recompute = await personaService.assignPersona(args.user_id, args.key);
      if (!recompute) return errorResult(`Persona '${args.key}' not found`);
      return jsonResult({ assigned: true, recompute });
    },
  );

  // mirrors DELETE /api/users/:id/personas/:key
  (server as any).registerTool(
    'unassign_persona',
    {
      title: 'Unassign Persona',
      description:
        'Unassign a persona from a user. Removes only memberships the persona ' +
        'sustains — rows another held persona still grants are re-homed to it, ' +
        'and direct grants are never touched.',
      inputSchema: unassignPersonaSchema,
    },
    async (args: z.infer<typeof unassignPersonaSchema>) => {
      const result = await personaService.unassignPersona(args.user_id, args.key);
      if (!result.personaFound) return errorResult(`Persona '${args.key}' not found`);
      if (!result.unassigned) return errorResult(`User does not hold persona '${args.key}'`);
      return jsonResult({ unassigned: true, recompute: result.recompute });
    },
  );

  // mirrors GET /api/users/:id/personas
  (server as any).registerTool(
    'get_user_personas',
    {
      title: 'Get User Personas',
      description:
        'The personas a user holds plus the composed role/scope map their ' +
        'memberships form (each row names the sustaining persona, or null for ' +
        'a direct grant).',
      inputSchema: getUserPersonasSchema,
    },
    async (args: z.infer<typeof getUserPersonasSchema>) => {
      const result = await personaService.getUserPersonas(args.user_id);
      return jsonResult(result);
    },
  );
}
