import { getPool } from '../../lib/db';
import {
  INSERT_ANNOUNCEMENT,
  LIST_ACTIVE_ANNOUNCEMENTS,
  DELETE_ANNOUNCEMENT,
} from './sql';

/**
 * A dashboard announcement — a broadcast notice on the dashboard surface.
 * Role targeting is display scoping only (live events reach every
 * authenticated socket); bodies must never carry secrets.
 */
export interface LTAnnouncement {
  id: string;
  title: string | null;
  /** Markdown. */
  body: string;
  layout: string;
  /** Empty = everyone; otherwise shown to holders of any named role. */
  roles: string[];
  created_by: string | null;
  created_at: string;
  expires_at: string;
}

/** Only the body is required; everything else has a liberal default (24h expiry). */
export async function createAnnouncement(input: {
  body: string;
  title?: string;
  layout?: string;
  roles?: string[];
  createdBy?: string;
  expiresAt?: string;
}): Promise<LTAnnouncement> {
  const { rows } = await getPool().query(INSERT_ANNOUNCEMENT, [
    input.title ?? null,
    input.body,
    input.layout ?? null,
    input.roles ?? null,
    input.createdBy ?? null,
    input.expiresAt ?? null,
  ]);
  return rows[0];
}

/** Active announcements visible to a viewer; null roles = the unscoped admin view. */
export async function listActiveAnnouncements(
  userRoles: string[] | null,
): Promise<LTAnnouncement[]> {
  const { rows } = await getPool().query(LIST_ACTIVE_ANNOUNCEMENTS, [userRoles]);
  return rows;
}

/** Returns the deleted row so the caller can publish its removal, or null. */
export async function deleteAnnouncement(id: string): Promise<LTAnnouncement | null> {
  const { rows } = await getPool().query(DELETE_ANNOUNCEMENT, [id]);
  return rows[0] ?? null;
}
