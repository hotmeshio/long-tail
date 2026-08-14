import * as announcementService from '../services/announcement';
import { publishAnnouncementEvent } from '../lib/events/publish';
import { getUserRoles } from '../services/user';
import type { LTApiResult, LTApiAuth } from '../types/sdk';

/**
 * Dashboard announcements — broadcast notices on the dashboard surface.
 * Publishing is a role-manager act (superadmin/admin/engineer via the route
 * guard); reading is any authenticated user, server-filtered to their roles.
 * Role targeting is display scoping only: the live event reaches every
 * authenticated subscriber, so bodies must never carry secrets.
 */

/** Create an announcement. Only `body` is required — everything else defaults. */
export async function createAnnouncement(
  input: {
    body?: string;
    title?: string;
    layout?: string;
    roles?: string[];
    expiresAt?: string;
  },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.body?.trim()) {
      return { status: 400, error: 'body is required' };
    }
    const announcement = await announcementService.createAnnouncement({
      body: input.body,
      title: input.title,
      layout: input.layout,
      roles: input.roles,
      expiresAt: input.expiresAt,
      createdBy: auth.userId,
    });
    await publishAnnouncementEvent({ type: 'announcement.created', announcement });
    return { status: 200, data: announcement };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/** Active announcements for the caller — admins see all, others their roles' slice. */
export async function listAnnouncements(auth: LTApiAuth): Promise<LTApiResult> {
  try {
    const unscoped = auth.role === 'superadmin' || auth.role === 'admin';
    const roles = unscoped
      ? null
      : (await getUserRoles(auth.userId)).map((r) => r.role);
    const announcements = await announcementService.listActiveAnnouncements(roles);
    return { status: 200, data: { announcements } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/** Remove an announcement; subscribers see it drop live. */
export async function deleteAnnouncement(
  input: { id: string },
  _auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const deleted = await announcementService.deleteAnnouncement(input.id);
    if (!deleted) return { status: 404, error: 'announcement not found' };
    await publishAnnouncementEvent({ type: 'announcement.deleted', announcement: deleted });
    return { status: 200, data: { deleted: true, id: input.id } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
