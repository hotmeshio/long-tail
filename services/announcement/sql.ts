// ─── Announcement queries ────────────────────────────────────────────────────
// Liberal defaults live in the SQL so the service contract is self-describing:
// only the body is required; layout, targeting, and the 24-hour expiry fill in.

export const INSERT_ANNOUNCEMENT = `
  INSERT INTO lt_announcements (title, body, layout, roles, created_by, expires_at)
  VALUES ($1, $2, COALESCE($3, 'banner'), COALESCE($4::text[], '{}'), $5,
          COALESCE($6::timestamptz, NOW() + INTERVAL '24 hours'))
  RETURNING *`;

/**
 * Active announcements for a viewer. $1 = the viewer's role names, or NULL
 * for the unscoped admin view. Untargeted rows (roles = '{}') reach everyone;
 * targeted rows reach holders of any named role.
 */
export const LIST_ACTIVE_ANNOUNCEMENTS = `
  SELECT * FROM lt_announcements
  WHERE expires_at > NOW()
    AND ($1::text[] IS NULL OR roles = '{}' OR roles && $1::text[])
  ORDER BY created_at DESC`;

export const DELETE_ANNOUNCEMENT = `
  DELETE FROM lt_announcements WHERE id = $1
  RETURNING *`;
