// ─── Persona CRUD ─────────────────────────────────────────────────────────────

/** Aggregated role links for one persona, as a JSON array column. */
const ROLES_LATERAL =
  `LEFT JOIN LATERAL (
     SELECT COALESCE(json_agg(json_build_object('role', pr.role, 'relationship', pr.relationship)
                     ORDER BY pr.created_at, pr.role), '[]'::json) AS roles
     FROM lt_persona_roles pr WHERE pr.persona_id = p.id
   ) r ON true
   LEFT JOIN LATERAL (
     SELECT COUNT(*)::int AS user_count FROM lt_user_personas up WHERE up.persona_id = p.id
   ) u ON true`;

export const LIST_PERSONAS =
  `SELECT p.id, p.key, p.title, p.description, r.roles, u.user_count, p.created_at, p.updated_at
   FROM lt_personas p
   ${ROLES_LATERAL}
   ORDER BY p.key`;

export const GET_PERSONA_BY_KEY =
  `SELECT p.id, p.key, p.title, p.description, r.roles, u.user_count, p.created_at, p.updated_at
   FROM lt_personas p
   ${ROLES_LATERAL}
   WHERE p.key = $1`;

export const CREATE_PERSONA =
  `INSERT INTO lt_personas (key, title, description) VALUES ($1, $2, $3)
   RETURNING id, key, title, description, created_at, updated_at`;

/** Declarative upsert for the seed pass — the spec is authoritative for title/description. */
export const UPSERT_PERSONA =
  `INSERT INTO lt_personas (key, title, description) VALUES ($1, $2, $3)
   ON CONFLICT (key) DO UPDATE SET
     title = EXCLUDED.title,
     description = EXCLUDED.description,
     updated_at = NOW()
   RETURNING id`;

/** PATCH semantics: $2/$4 are set-sentinels gating whether $3/$5 write. */
export const UPDATE_PERSONA =
  `UPDATE lt_personas SET
     title       = CASE WHEN $2 THEN $3 ELSE title END,
     description = CASE WHEN $4 THEN $5 ELSE description END,
     updated_at  = NOW()
   WHERE key = $1
   RETURNING id, key, title, description, created_at, updated_at`;

export const DELETE_PERSONA = 'DELETE FROM lt_personas WHERE id = $1';

export const GET_PERSONA_ASSIGNEES =
  `SELECT us.id, us.external_id, us.display_name, us.email, up.created_at AS assigned_at
   FROM lt_user_personas up
   JOIN lt_users us ON us.id = up.user_id
   WHERE up.persona_id = $1
   ORDER BY up.created_at, us.external_id`;

// ─── Role links ───────────────────────────────────────────────────────────────

export const UPSERT_PERSONA_ROLE =
  `INSERT INTO lt_persona_roles (persona_id, role, relationship) VALUES ($1, $2, $3)
   ON CONFLICT (persona_id, role) DO UPDATE SET relationship = EXCLUDED.relationship
   RETURNING role, relationship`;

export const DELETE_PERSONA_ROLE =
  'DELETE FROM lt_persona_roles WHERE persona_id = $1 AND role = $2';

/** Replace a persona's links declaratively: prune links not in $2, upsert the rest. */
export const SYNC_PERSONA_ROLES =
  `WITH incoming AS (
     SELECT x.role, x.relationship
     FROM unnest($2::text[], $3::text[]) AS x(role, relationship)
   ), pruned AS (
     DELETE FROM lt_persona_roles pr
     WHERE pr.persona_id = $1 AND pr.role NOT IN (SELECT role FROM incoming)
   )
   INSERT INTO lt_persona_roles (persona_id, role, relationship)
   SELECT $1, role, relationship FROM incoming
   ON CONFLICT (persona_id, role) DO UPDATE SET relationship = EXCLUDED.relationship`;

// ─── Assignment ───────────────────────────────────────────────────────────────

export const INSERT_USER_PERSONA =
  `INSERT INTO lt_user_personas (user_id, persona_id) VALUES ($1, $2)
   ON CONFLICT DO NOTHING`;

export const DELETE_USER_PERSONA =
  'DELETE FROM lt_user_personas WHERE user_id = $1 AND persona_id = $2';

export const LIST_PERSONA_HOLDER_IDS =
  'SELECT user_id FROM lt_user_personas WHERE persona_id = $1';

/** Users with a membership row still sustained by this persona (drift guard for delete). */
export const LIST_SUSTAINED_USER_IDS =
  'SELECT DISTINCT user_id FROM lt_user_roles WHERE granted_by_persona = $1';

// ─── Recompute: materialize persona grants into lt_user_roles ────────────────
//
// The single reconciliation statement behind assign, unassign, link edits,
// persona deletion, and seeding. For every user in $1::uuid[], it derives the
// highest-allowance union of the user's currently-held personas and reconciles
// lt_user_roles against it:
//
//   removed   — persona-sustained rows no held persona still grants
//   refreshed — persona-sustained rows overlaid fresh (union scope, re-homed
//               provenance so unassigning one persona never drops a role a
//               sibling persona still grants)
//   raised    — DIRECT rows lifted to at least the union (highest allowance
//               wins); scope is never lowered, type and provenance untouched
//   granted   — missing rows inserted as scoped members
//
// Direct rows (granted_by_persona IS NULL) are never deleted here — persona
// removal must not touch hand-tuned memberships. Write-rank encoding:
// write-all=2 (all), write-self=1 (self), read-all=0 (none).
export const RECOMPUTE_PERSONA_MEMBERSHIPS =
  `WITH affected AS (
     SELECT unnest($1::uuid[]) AS user_id
   ), grants AS (
     SELECT up.user_id, pr.role,
            MAX(CASE pr.relationship WHEN 'write-all' THEN 2 WHEN 'write-self' THEN 1 ELSE 0 END) AS write_rank,
            (MIN(pr.persona_id::text))::uuid AS sustaining_persona
     FROM lt_user_personas up
     JOIN lt_persona_roles pr ON pr.persona_id = up.persona_id
     JOIN affected a ON a.user_id = up.user_id
     GROUP BY up.user_id, pr.role
   ), removed AS (
     DELETE FROM lt_user_roles ur
     USING affected a
     WHERE ur.user_id = a.user_id
       AND ur.granted_by_persona IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM grants g WHERE g.user_id = ur.user_id AND g.role = ur.role)
     RETURNING ur.user_id, ur.role
   ), refreshed AS (
     UPDATE lt_user_roles ur
     SET read_scope = 'all',
         write_scope = CASE g.write_rank WHEN 2 THEN 'all' WHEN 1 THEN 'self' ELSE 'none' END,
         granted_by_persona = g.sustaining_persona
     FROM grants g
     WHERE ur.user_id = g.user_id AND ur.role = g.role
       AND ur.granted_by_persona IS NOT NULL
     RETURNING ur.user_id, ur.role
   ), raised AS (
     UPDATE lt_user_roles ur
     SET read_scope = 'all',
         write_scope = CASE
           WHEN g.write_rank = 2 THEN 'all'
           WHEN g.write_rank = 1 AND ur.write_scope = 'none' THEN 'self'
           ELSE ur.write_scope
         END
     FROM grants g
     WHERE ur.user_id = g.user_id AND ur.role = g.role
       AND ur.granted_by_persona IS NULL
       AND (ur.read_scope <> 'all'
            OR g.write_rank > CASE ur.write_scope WHEN 'all' THEN 2 WHEN 'self' THEN 1 ELSE 0 END)
     RETURNING ur.user_id, ur.role
   ), granted AS (
     INSERT INTO lt_user_roles (user_id, role, type, read_scope, write_scope, granted_by_persona)
     SELECT g.user_id, g.role, 'member', 'all',
            CASE g.write_rank WHEN 2 THEN 'all' WHEN 1 THEN 'self' ELSE 'none' END,
            g.sustaining_persona
     FROM grants g
     WHERE NOT EXISTS (SELECT 1 FROM lt_user_roles ur WHERE ur.user_id = g.user_id AND ur.role = g.role)
     RETURNING user_id, role
   )
   SELECT
     (SELECT COUNT(*)::int FROM granted)   AS granted,
     (SELECT COUNT(*)::int FROM refreshed) AS refreshed,
     (SELECT COUNT(*)::int FROM raised)    AS raised,
     (SELECT COUNT(*)::int FROM removed)   AS removed`;

// ─── forUser ──────────────────────────────────────────────────────────────────

export const GET_USER_PERSONAS =
  `SELECT p.id, p.key, p.title, p.description, r.roles, up.created_at AS assigned_at
   FROM lt_user_personas up
   JOIN lt_personas p ON p.id = up.persona_id
   LEFT JOIN LATERAL (
     SELECT COALESCE(json_agg(json_build_object('role', pr.role, 'relationship', pr.relationship)
                     ORDER BY pr.created_at, pr.role), '[]'::json) AS roles
     FROM lt_persona_roles pr WHERE pr.persona_id = p.id
   ) r ON true
   WHERE up.user_id = $1
   ORDER BY p.key`;

/** The composed role/scope map: every membership with its sustaining persona key (null = direct). */
export const GET_USER_COMPOSED_ROLES =
  `SELECT ur.role, ur.read_scope, ur.write_scope, p.key AS granted_by_persona
   FROM lt_user_roles ur
   LEFT JOIN lt_personas p ON p.id = ur.granted_by_persona
   WHERE ur.user_id = $1
   ORDER BY ur.role`;

// ─── Shared ───────────────────────────────────────────────────────────────────

export const GET_PERSONA_ID_BY_KEY = 'SELECT id FROM lt_personas WHERE key = $1';

export const ENSURE_ROLES_EXIST =
  `INSERT INTO lt_roles (role) SELECT DISTINCT unnest($1::text[]) ON CONFLICT DO NOTHING`;
