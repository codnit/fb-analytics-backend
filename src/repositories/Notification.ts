import { getDB } from "../config/database";
import { BaseRepository } from "../core/base.repository";
import type { NotificationCreateInput, NotificationEntity } from "../types/domain";
import { PrismaHelpers } from "../utils/prismaHelpers";
import { getFacebookPostUrl } from "../utils/facebookPostUrl";

export class NotificationRepository extends BaseRepository<NotificationEntity> {
  protected readonly tableName = "notifications";

  protected get delegate() {
    return getDB().notification;
  }

  async createPublishedNotification(data: NotificationCreateInput): Promise<NotificationEntity> {
    const notification = await getDB().notification.upsert({
      where: {
        recipient_partner_id_publishing_post_id_type: {
          recipient_partner_id: data.recipient_partner_id,
          publishing_post_id: data.publishing_post_id,
          type: data.type || "facebook_post_published",
        },
      },
      create: PrismaHelpers.stripUndefined({
        ...data,
        type: data.type || "facebook_post_published",
      }),
      update: {},
    });

    return PrismaHelpers.normalizeRecord(notification) as NotificationEntity;
  }

  async updatePublishedPostLink(publishingPostId: string, postUrl: string | null, message?: string | null): Promise<void> {
    await getDB().notification.updateMany({
      where: { publishing_post_id: publishingPostId },
      data: {
        post_url: postUrl,
        ...(message !== undefined ? { message } : {}),
      },
    });
  }

  async deleteByPublishingPostId(publishingPostId: string): Promise<void> {
    await getDB().notification.deleteMany({ where: { publishing_post_id: publishingPostId } });
  }

  async getPartnerNotifications(partnerId: string, limit = 20): Promise<NotificationEntity[]> {
    const notifications = await this.findManyRecords({
      where: { recipient_partner_id: partnerId },
      orderBy: { created_at: "desc" },
      take: Math.min(Math.max(limit, 1), 50),
    });

    if (notifications.length === 0) return notifications;

    const publishingPosts = await getDB().publishingPost.findMany({
      where: { id: { in: notifications.map((notification) => notification.publishing_post_id) } },
      select: { id: true, fb_page_id: true, fb_post_id: true, permalink: true },
    });
    const postsById = new Map(publishingPosts.map((post) => [post.id, post]));

    return notifications.map((notification) => {
      const facebookUrl = getFacebookPostUrl(postsById.get(notification.publishing_post_id));
      return facebookUrl ? { ...notification, post_url: facebookUrl } : notification;
    });
  }

  async getUnreadCount(partnerId: string): Promise<number> {
    return getDB().notification.count({
      where: { recipient_partner_id: partnerId, is_read: false },
    });
  }

  async markRead(notificationId: string, partnerId: string): Promise<boolean> {
    const result = await getDB().notification.updateMany({
      where: {
        id: notificationId,
        recipient_partner_id: partnerId,
        is_read: false,
      },
      data: {
        is_read: true,
        read_at: new Date(),
      },
    });

    return result.count > 0;
  }

  async markAllRead(partnerId: string): Promise<number> {
    const result = await getDB().notification.updateMany({
      where: { recipient_partner_id: partnerId, is_read: false },
      data: { is_read: true, read_at: new Date() },
    });

    return result.count;
  }
}

export default new NotificationRepository();
