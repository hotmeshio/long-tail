/**
 * User and role management tools — mirrors routes/users.ts + routes/roles.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import * as userService from '../../../services/user';
import * as roleService from '../../../services/role';
import {
  listUsersSchema,
  createUserSchema,
  addUserRoleSchema,
  removeUserRoleSchema,
  listRolesSchema,
  createRoleSchema,
  addEscalationChainSchema,
  updateRoleSchema,
} from './schemas';

export function registerUserTools(server: McpServer): void {

  // mirrors GET /api/users
  (server as any).registerTool(
    'list_users',
    {
      title: 'List Users',
      description: 'List user accounts with optional role and status filters.',
      inputSchema: listUsersSchema,
    },
    async (args: z.infer<typeof listUsersSchema>) => {
      const { users, total } = await userService.listUsers({
        role: args.role,
        status: args.status as any,
        limit: args.limit,
        offset: args.offset,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            total,
            count: users.length,
            users: users.map((u) => ({
              id: u.id,
              external_id: u.external_id,
              display_name: u.display_name,
              account_type: u.account_type,
              status: u.status,
            })),
          }),
        }],
      };
    },
  );

  // mirrors POST /api/users
  (server as any).registerTool(
    'create_user',
    {
      title: 'Create User',
      description:
        'Create a new user account with optional roles. The user can then ' +
        'claim and resolve escalations for their assigned roles.',
      inputSchema: createUserSchema,
    },
    async (args: z.infer<typeof createUserSchema>) => {
      // roles carry optional read_scope/write_scope (default all/all); createUser
      // normalizes admin/superadmin to all/all and stores member scope verbatim.
      for (const r of args.roles) {
        const read = r.read_scope ?? userService.DEFAULT_READ_SCOPE;
        const write = r.write_scope ?? userService.DEFAULT_WRITE_SCOPE;
        if (!userService.isValidScopePair(read, write)) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `write_scope=all requires read_scope=all (role "${r.role}")` }],
          };
        }
      }
      const user = await userService.createUser({
        external_id: args.external_id,
        display_name: args.display_name,
        email: args.email,
        roles: args.roles,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(user) }],
      };
    },
  );

  // mirrors POST /api/users/:id/roles
  (server as any).registerTool(
    'add_user_role',
    {
      title: 'Add User Role',
      description:
        'Assign a role to a user. Role type: member, admin, or superadmin. For a ' +
        'member, optional read_scope/write_scope set the work-surface (e.g. ' +
        'read_scope=self + write_scope=self for a one-time user who only handles ' +
        'their own pre-assigned escalation).',
      inputSchema: addUserRoleSchema,
    },
    async (args: z.infer<typeof addUserRoleSchema>) => {
      const read = args.read_scope ?? userService.DEFAULT_READ_SCOPE;
      const write = args.write_scope ?? userService.DEFAULT_WRITE_SCOPE;
      if (!userService.isValidScopePair(read, write)) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'write_scope=all requires read_scope=all' }],
        };
      }
      const result = await userService.addUserRole(args.user_id, args.role, args.type, {
        read_scope: args.read_scope,
        write_scope: args.write_scope,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // mirrors DELETE /api/users/:id/roles/:role
  (server as any).registerTool(
    'remove_user_role',
    {
      title: 'Remove User Role',
      description: 'Remove a role from a user.',
      inputSchema: removeUserRoleSchema,
    },
    async (args: z.infer<typeof removeUserRoleSchema>) => {
      const removed = await userService.removeUserRole(args.user_id, args.role);
      if (!removed) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Role not found' }) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ removed: true }) }],
      };
    },
  );

  // mirrors GET /api/roles
  (server as any).registerTool(
    'list_roles',
    {
      title: 'List Roles',
      description: 'List all distinct roles known to the system.',
      inputSchema: listRolesSchema,
    },
    async (_args: z.infer<typeof listRolesSchema>) => {
      const roles = await roleService.listDistinctRoles();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ roles }) }],
      };
    },
  );

  // mirrors POST /api/roles
  (server as any).registerTool(
    'create_role',
    {
      title: 'Create Role',
      description:
        'Create a new role. Role names must be lowercase alphanumeric ' +
        'with hyphens/underscores, starting with a letter.',
      inputSchema: createRoleSchema,
    },
    async (args: z.infer<typeof createRoleSchema>) => {
      const trimmed = args.role.trim().toLowerCase();
      if (!/^[a-z][a-z0-9_-]*$/.test(trimmed)) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: 'Role must start with a letter and contain only lowercase letters, numbers, hyphens, and underscores' }),
          }],
          isError: true,
        };
      }
      await roleService.createRole(trimmed);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ role: trimmed, created: true }) }],
      };
    },
  );

  // mirrors POST /api/roles/escalation-chains
  (server as any).registerTool(
    'add_escalation_chain',
    {
      title: 'Add Escalation Chain',
      description:
        'Define an escalation path from one role to another. Users with ' +
        'the source role can escalate work to the target role.',
      inputSchema: addEscalationChainSchema,
    },
    async (args: z.infer<typeof addEscalationChainSchema>) => {
      await roleService.addEscalationChain(args.source_role, args.target_role);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            created: true,
            source_role: args.source_role,
            target_role: args.target_role,
          }),
        }],
      };
    },
  );

  // mirrors PATCH /api/roles/:role
  (server as any).registerTool(
    'update_role',
    {
      title: 'Update Role',
      description:
        'Update role metadata: display name, description, form schema, properties ' +
        '(SLA targets, throughput goals), ops_visible flag, and parent role ' +
        'for the process dependency graph.',
      inputSchema: updateRoleSchema,
    },
    async (args: z.infer<typeof updateRoleSchema>) => {
      const updated = await roleService.updateRoleMetadata(args.role, {
        title: args.title,
        description: args.description,
        form_schema: args.form_schema as Record<string, any> | null | undefined,
        metadata_schema: args.metadata_schema as Record<string, any> | null | undefined,
        properties: args.properties as Record<string, any> | null | undefined,
        ops_visible: args.ops_visible,
        parent_role: args.parent_role,
        sla_minutes: args.sla_minutes,
        target_per_hour: args.target_per_hour,
        worker_count: args.worker_count,
      });
      if (!updated) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Role '${args.role}' not found` }) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(updated) }],
      };
    },
  );
}
