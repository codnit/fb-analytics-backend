import type { ConnectedPageEntity, NotificationEntity, PublishingPostEntity } from "../../types/domain";
import notificationRepository from "../../repositories/Notification";
import { notificationEventBus } from "./notification.events";
import { getFacebookPostUrl } from "../../utils/facebookPostUrl";

export class NotificationService {
  async listForPartner(partnerId: string, limit = 20): Promise<{ items: NotificationEntity[]; unreadCount: number }> {
    const [items, unreadCount] = await Promise.all([
      notificationRepository.getPartnerNotifications(partnerId, limit),
      notificationRepository.getUnreadCount(partnerId),
    ]);

    return { items, unreadCount };
  }

  async createPublishedNotification(page: ConnectedPageEntity, post: PublishingPostEntity): Promise<NotificationEntity> {
    const notification = await notificationRepository.createPublishedNotification({
      recipient_partner_id: page.partner_id,
      connected_page_id: page.id,
      publishing_post_id: post.id,
      type: "facebook_post_published",
      title: "New Facebook post published",
      message: post.message || post.link || "Your Facebook Page received a new post.",
      page_name: page.page_name || page.fb_page_id,
      post_url: getFacebookPostUrl(post),
    });

    void notificationEventBus.publish(page.partner_id, {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      page_name: notification.page_name,
      post_url: notification.post_url,
      is_read: notification.is_read,
      read_at: notification.read_at,
      created_at: notification.created_at,
    });

    return notification;
  }

  updatePublishedNotification(post: PublishingPostEntity): Promise<void> {
    return notificationRepository.updatePublishedPostLink(post.id, getFacebookPostUrl(post), post.message || null);
  }

  deleteForPublishingPost(publishingPostId: string): Promise<void> {
    return notificationRepository.deleteByPublishingPostId(publishingPostId);
  }

  markRead(notificationId: string, partnerId: string): Promise<boolean> {
    return notificationRepository.markRead(notificationId, partnerId);
  }

  markAllRead(partnerId: string): Promise<number> {
    return notificationRepository.markAllRead(partnerId);
  }
}

export default new NotificationService();
