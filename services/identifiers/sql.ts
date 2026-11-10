const COLUMNS = `id::text AS id, scheme_version, raw, target, exclusive, bound_by, bound_via, bound_at, retired_at, retired_by`;

/** A new live binding; nothing when the raw (or, for an exclusive scheme, the target) is already live. */
export const INSERT_BINDING = `\
INSERT INTO lt_identifier_bindings (scheme_version, raw, target, exclusive, bound_by, bound_via)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT DO NOTHING
RETURNING ${COLUMNS}`;

export const LIVE_BY_RAW = `\
SELECT ${COLUMNS} FROM lt_identifier_bindings
WHERE scheme_version = $1 AND raw = $2 AND retired_at IS NULL`;

/** Retire the live binding of a raw. */
export const RETIRE_RAW = `\
UPDATE lt_identifier_bindings SET retired_at = NOW(), retired_by = $3
WHERE scheme_version = $1 AND raw = $2 AND retired_at IS NULL
RETURNING ${COLUMNS}`;

/** Retire a target's live bindings other than `raw`'s. */
export const RETIRE_TARGET_OTHERS = `\
UPDATE lt_identifier_bindings SET retired_at = NOW(), retired_by = $4
WHERE scheme_version = $1 AND target = $2 AND raw <> $3 AND retired_at IS NULL
RETURNING ${COLUMNS}`;

export const RETIRE_BY_ID = `\
UPDATE lt_identifier_bindings SET retired_at = NOW(), retired_by = $3
WHERE scheme_version = $1 AND id = $2 AND retired_at IS NULL
RETURNING ${COLUMNS}`;

export const LIST_BINDINGS = `\
SELECT ${COLUMNS} FROM lt_identifier_bindings
WHERE scheme_version = $1
  AND ($2::text IS NULL OR target = $2)
  AND ($3::text IS NULL OR raw = $3)
  AND ($4::boolean OR retired_at IS NULL)
ORDER BY bound_at DESC, id DESC
LIMIT $5 OFFSET $6`;
