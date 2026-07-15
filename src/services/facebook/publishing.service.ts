import { BaseGraphClient } from "../../core/base.graph-client";
import connectedPageRepository from "../../repositories/ConnectedPage";
import publishingPostRepository from "../../repositories/PublishingPost";
import type { ConnectedPageEntity, PublishingPostEntity } from "../../types/domain";
import { decryptPageToken } from "../../utils/pageTokenCrypto";
import { isUuid } from "../../utils/uuid";
import storageService from "../storage.service";
import notificationService from "../notifications/notification.service";
import axios from "axios";
import type { Readable } from "stream";

type PublishPostInput = {
  pageId: string;
  postType: "text" | "link" | "photo" | "video";
  message?: string;
  link?: string;
  mediaUrl?: string;
  mediaObjectKey?: string;
  scheduledPublishTime?: string;
  createdBy?: string;
  createdVia?: string;
};

type UpdatePostInput = {
  message?: string;
  scheduledPublishTime?: string;
  mediaUrl?: string;
  mediaObjectKey?: string;
};

export type PublishingActor = {
  id: string;
  type: "admin" | "partner" | "api";
};

const toScheduledDate = (value?: string): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("scheduledPublishTime must be a valid date");
  }
  if (date.getTime() < Date.now() + 10 * 60 * 1000) {
    throw new Error("scheduledPublishTime must be at least 10 minutes in the future");
  }
  return date;
};

const MAX_RETRY_ATTEMPTS = 3;
const REQUIRED_PUBLISHING_PERMISSION = "pages_manage_posts";

class PublishingGraphError extends Error {
  statusCode: number;
  retryable: boolean;
  details?: unknown;

  constructor(message: string, statusCode: number, retryable: boolean, details?: unknown) {
    super(message);
    this.name = "PublishingGraphError";
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.details = details;
  }
}

const getNextRetryAt = (attemptCount: number): Date => {
  const backoffMinutes = Math.min(30, Math.max(1, attemptCount) * 5);
  return new Date(Date.now() + backoffMinutes * 60 * 1000);
};

export class FacebookPublishingService extends BaseGraphClient {
  constructor() {
    super();
  }

  async listPublishingPages(actor?: PublishingActor): Promise<ConnectedPageEntity[]> {
    const pages = actor?.type === "partner"
      ? await connectedPageRepository.getPartnerPages(actor.id)
      : await connectedPageRepository.getAllActivePages();
    return pages.filter((page) => page.is_active && this.hasPublishingPermission(page));
  }

  async publishPost(input: PublishPostInput, actor?: PublishingActor): Promise<PublishingPostEntity> {
    const page = await this.resolvePage(input.pageId, actor);
    const scheduledDate = toScheduledDate(input.scheduledPublishTime);

    const record = await publishingPostRepository.createPublishingPost({
      page_id: page.id,
      fb_page_id: page.fb_page_id,
      post_type: input.postType,
      message: input.message || null,
      link: input.link || null,
      media_url: input.mediaUrl || null,
      media_object_key: input.mediaObjectKey || null,
      scheduled_publish_time: scheduledDate,
      status: "publishing",
      attempt_count: 0,
      created_by: input.createdBy || null,
      created_via: input.createdVia || "api",
    });

    return this.attemptPublish(record, actor);
  }

  async listPosts(
    pageId: string,
    status?: string,
    actor?: PublishingActor,
    pageNumber = 1,
    limit = 10
  ): Promise<{ posts: PublishingPostEntity[]; pagination: Record<string, number | boolean> }> {
    const connectedPage = await this.resolvePage(pageId, actor);
    const deletedPosts = await publishingPostRepository.getDeletedPublishingPosts(connectedPage.id);
    for (const deletedPost of deletedPosts) {
      await notificationService.deleteForPublishingPost(deletedPost.id);
      await storageService.deleteObject(deletedPost.media_object_key).catch((error) => {
        console.warn("[publishing] Failed to purge deleted post media object:", error instanceof Error ? error.message : String(error));
      });
      await publishingPostRepository.deletePublishingPost(deletedPost.id);
    }
    const safePage = Math.max(1, pageNumber);
    const safeLimit = Math.min(50, Math.max(1, limit));
    const result = await publishingPostRepository.getPagePublishingPosts(connectedPage.id, status, safePage, safeLimit);
    const totalPages = result.total > 0 ? Math.ceil(result.total / safeLimit) : 0;
    return {
      posts: result.posts,
      pagination: {
        currentPage: safePage,
        pageSize: safeLimit,
        totalItems: result.total,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPreviousPage: safePage > 1,
      },
    };
  }

  async reconcileScheduledPosts(limit = 100): Promise<number> {
    const scheduledPosts = await publishingPostRepository.getDueScheduledPosts(limit);
    let publishedCount = 0;

    for (const post of scheduledPosts) {
      if (!post.fb_post_id) continue;

      try {
        const page = await this.resolvePage(post.page_id);
        const accessToken = this.getPublishingToken(page);
        const response = await this.http.get(`/${post.fb_post_id}`, {
          params: {
            access_token: accessToken,
            fields: "id,is_published,permalink_url,created_time",
          },
        });
        const data = response.data as {
          id?: string;
          is_published?: boolean;
          permalink_url?: string;
        };

        if (data.is_published !== true) continue;

        const updated = await publishingPostRepository.updatePublishingPost(post.id, {
          status: "published",
          permalink: data.permalink_url || post.permalink || null,
          graph_response: response.data as never,
          error_message: null,
          next_retry_at: null,
        });

        if (post.media_object_key) {
          try {
            await storageService.deleteObject(post.media_object_key);
            await publishingPostRepository.updatePublishingPost(post.id, {
              media_url: null,
              media_object_key: null,
            });
          } catch (cleanupError) {
            console.warn("[publishing] Failed to delete scheduled media object:", cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
          }
        }

        await notificationService.createPublishedNotification(page, updated);
        publishedCount++;
      } catch (error) {
        console.warn("[publishing] Scheduled post reconciliation failed", {
          postId: post.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return publishedCount;
  }

  async updatePost(postId: string, input: UpdatePostInput, actor?: PublishingActor): Promise<PublishingPostEntity> {
    const post = await publishingPostRepository.getPublishingPostById(postId);
    if (!post) throw new Error("Publishing post not found");
    if (!["published", "scheduled"].includes(post.status)) {
      throw new Error("Only published or scheduled posts can be edited");
    }
    if (!post.fb_post_id) throw new Error("Facebook post id is not available yet");

    const page = await this.resolvePage(post.page_id, actor);
    const accessToken = this.getPublishingToken(page);

    if (input.mediaUrl) {
      if (!["photo", "video"].includes(post.post_type)) {
        throw new Error("Only photo and video posts support media replacement");
      }

      const scheduledDate = input.scheduledPublishTime
        ? toScheduledDate(input.scheduledPublishTime)
        : post.status === "scheduled"
          ? post.scheduled_publish_time || null
          : null;

      return this.replaceMediaPost(post, page, accessToken, input, scheduledDate);
    }

    const params = new URLSearchParams({ access_token: accessToken });
    const scheduledDate = toScheduledDate(input.scheduledPublishTime);

    if (input.message !== undefined) params.append("message", input.message);
    if (scheduledDate) {
      params.append("published", "false");
      params.append("scheduled_publish_time", String(Math.floor(scheduledDate.getTime() / 1000)));
    }

    const graphResponse = await this.http.post(`/${post.fb_post_id}`, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    return publishingPostRepository.updatePublishingPost(post.id, {
      message: input.message !== undefined ? input.message : post.message,
      scheduled_publish_time: scheduledDate || post.scheduled_publish_time || null,
      status: scheduledDate ? "scheduled" : post.status,
      graph_response: graphResponse.data as never,
      error_message: null,
    });
  }

  async retryPost(postId: string, actor?: PublishingActor): Promise<PublishingPostEntity> {
    const post = await publishingPostRepository.getPublishingPostById(postId);
    if (!post) throw new Error("Publishing post not found");
    if (!["failed", "failed_retryable"].includes(post.status)) {
      throw new Error("Only failed publishing posts can be retried");
    }

    await this.resolvePage(post.page_id, actor);
    return this.attemptPublish(post, actor);
  }

  async getPostMediaPreview(postId: string, actor?: PublishingActor): Promise<{
    previewUrl: string | null;
    thumbnailUrl: string | null;
    previewType: "image" | "video" | "link" | null;
    linkUrl: string | null;
  }> {
    const post = await publishingPostRepository.getPublishingPostById(postId);
    if (!post) throw new Error("Publishing post not found");
    // Scheduled media remains in R2 until Meta publishes the post. Published
    // posts use a fresh Meta attachment URL instead of the temporary upload.
    const retainedMediaUrl = post.status === "published"
      ? null
      : post.media_url || null;
    const fallback = {
      previewUrl: retainedMediaUrl,
      thumbnailUrl: post.post_type === "video" ? null : retainedMediaUrl,
      previewType: post.post_type === "link"
        ? "link" as const
        : post.post_type === "video" && retainedMediaUrl
          ? "video" as const
          : retainedMediaUrl
            ? "image" as const
            : null,
      linkUrl: post.link || post.permalink || null,
    };
    if (!post.fb_post_id || post.status === "scheduled") return fallback;

    const page = await this.resolvePage(post.page_id, actor);
    const accessToken = this.getPublishingToken(page);

    if (post.status === "scheduled" && ["photo", "video"].includes(post.post_type)) {
      try {
        const fields = post.post_type === "video"
          ? "source,picture,permalink_url"
          : "source,images,permalink_url";
        const response = await this.http.get(`/${post.fb_post_id}`, {
          params: { access_token: accessToken, fields },
        });
        const imageUrl = post.post_type === "video"
          ? response.data?.picture || null
          : response.data?.images?.[0]?.source || response.data?.source || null;
        const sourceUrl = response.data?.source || null;
        return {
          previewUrl: post.post_type === "video" ? sourceUrl || imageUrl || retainedMediaUrl : imageUrl || retainedMediaUrl,
          thumbnailUrl: imageUrl,
          previewType: post.post_type === "video" && sourceUrl ? "video" : imageUrl || retainedMediaUrl ? "image" : null,
          linkUrl: response.data?.permalink_url || post.link || post.permalink || null,
        };
      } catch (error) {
        console.warn("[publishing] Scheduled media preview fallback used:", error instanceof Error ? error.message : String(error));
        return fallback;
      }
    }

    if (post.post_type === "video") {
      try {
        const response = await this.http.get(`/${post.fb_post_id}`, {
          params: {
            access_token: accessToken,
            fields: "source,picture,permalink_url",
          },
        });
        const videoUrl = response.data?.source || null;
        const thumbnailUrl = response.data?.picture || null;

        return {
          previewUrl: videoUrl || thumbnailUrl,
          thumbnailUrl,
          previewType: videoUrl ? "video" : thumbnailUrl ? "image" : null,
          linkUrl: response.data?.permalink_url || post.link || post.permalink || null,
        };
      } catch (error) {
        console.warn("[publishing] Unable to load video preview:", error instanceof Error ? error.message : String(error));
        return fallback;
      }
    }

    try {
      const response = await this.http.get(`/${post.fb_post_id}`, {
        params: {
          access_token: accessToken,
          fields: "attachments{media{image{src},source},url},permalink_url",
        },
      });
      const attachments = Array.isArray(response.data?.attachments?.data)
        ? response.data.attachments.data
        : [];
      const attachment = attachments.find((item: any) => item?.media?.image?.src || item?.media?.source || item?.url)
        || attachments[0]
        || null;
      const pictureUrl = attachment?.media?.image?.src || null;
      const sourceUrl = attachment?.media?.source || null;
      const attachmentType = String(attachment?.media_type || attachment?.type || "").toLowerCase();
      const isVideo = post.post_type === "video" || attachmentType.includes("video");
      const attachmentLink = attachment?.url || attachment?.target?.url || null;
      return {
        previewUrl: isVideo ? sourceUrl || pictureUrl : pictureUrl,
        thumbnailUrl: pictureUrl,
        previewType: isVideo && sourceUrl ? "video" : post.post_type === "link" ? "link" : pictureUrl ? "image" : null,
        linkUrl: attachmentLink || post.link || response.data?.permalink_url || post.permalink || null,
      };
    } catch (error) {
      console.warn("[publishing] Unable to load post preview:", error instanceof Error ? error.message : String(error));
      return fallback;
    }
  }

  async uploadMedia(input: {
    pageId: string;
    filename: string;
    contentType: string;
    body: Buffer | Readable;
  }, actor?: PublishingActor): Promise<{ mediaUrl: string; objectKey: string }> {
    const page = await this.resolvePage(input.pageId, actor);
    const uploaded = await storageService.uploadPublishingMedia({
      body: input.body,
      filename: input.filename,
      contentType: input.contentType,
      pageId: page.id,
    });

    return {
      mediaUrl: uploaded.url,
      objectKey: uploaded.key,
    };
  }

  async deletePost(postId: string, actor?: PublishingActor): Promise<PublishingPostEntity> {
    const post = await publishingPostRepository.getPublishingPostById(postId);
    if (!post) throw new Error("Publishing post not found");

    const page = await this.resolvePage(post.page_id, actor);
    const accessToken = this.getPublishingToken(page);

    await this.deleteFacebookPost(post.fb_post_id, accessToken);
    await storageService.deleteObject(post.media_object_key).catch((error) => {
      console.warn("[publishing] Failed to delete post media object:", error instanceof Error ? error.message : String(error));
    });
    await notificationService.deleteForPublishingPost(post.id);

    return publishingPostRepository.updatePublishingPost(post.id, {
      status: "deleted",
      error_message: null,
    });
  }

  private async resolvePage(pageId: string, actor?: PublishingActor): Promise<ConnectedPageEntity> {
    const page = isUuid(pageId)
      ? await connectedPageRepository.getPageById(pageId)
      : await connectedPageRepository.getPageByFbPageId(pageId);

    if (!page) throw new Error("Connected page not found");
    if (actor?.type === "partner" && page.partner_id !== actor.id) {
      throw new Error("You are not authorized to publish to this Page");
    }
    return page;
  }

  private async replaceMediaPost(
    post: PublishingPostEntity,
    page: ConnectedPageEntity,
    accessToken: string,
    input: UpdatePostInput,
    scheduledDate: Date | null
  ): Promise<PublishingPostEntity> {
    try {
      const graphResponse = await this.sendPublishRequest(page.fb_page_id, accessToken, {
        pageId: page.id,
        postType: post.post_type as "photo" | "video",
        message: input.message !== undefined ? input.message : post.message || undefined,
        mediaUrl: input.mediaUrl,
        mediaObjectKey: input.mediaObjectKey,
      }, scheduledDate);
      const newFacebookPostId = this.extractFacebookPostId(graphResponse);
      if (!newFacebookPostId) {
        throw new Error("Meta did not return an id for the replacement photo post");
      }

      const permalink = await this.resolveFacebookPostPermalink(page.fb_page_id, newFacebookPostId, accessToken);

      try {
        await this.deleteFacebookPost(post.fb_post_id, accessToken);
      } catch (deleteError) {
        await this.deleteFacebookPost(newFacebookPostId, accessToken).catch(() => undefined);
        throw deleteError;
      }

      const updated = await publishingPostRepository.updatePublishingPost(post.id, {
        fb_post_id: newFacebookPostId,
        permalink,
        message: input.message !== undefined ? input.message : post.message,
        media_url: input.mediaUrl,
        media_object_key: scheduledDate ? input.mediaObjectKey || null : null,
        scheduled_publish_time: scheduledDate,
        status: scheduledDate ? "scheduled" : "published",
        graph_response: graphResponse as never,
        error_message: null,
        next_retry_at: null,
      });

      try {
        await notificationService.updatePublishedNotification(updated);
      } catch (notificationError) {
        console.error("[publishing] Failed to update existing post notification:", notificationError);
      }
      return updated;
    } finally {
      if (!scheduledDate) {
        await storageService.deleteObject(input.mediaObjectKey).catch((error) => {
          console.warn("[publishing] Failed to delete replacement media object:", error instanceof Error ? error.message : String(error));
        });
      }
    }
  }

  private async deleteFacebookPost(facebookPostId: string | null | undefined, accessToken: string): Promise<void> {
    if (!facebookPostId) return;

    const params = new URLSearchParams({
      access_token: accessToken,
      method: "delete",
    });
    await this.http.post(`/${facebookPostId}`, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  }

  private async attemptPublish(post: PublishingPostEntity, actor?: PublishingActor): Promise<PublishingPostEntity> {
    const page = await this.resolvePage(post.page_id, actor);
    const accessToken = this.getPublishingToken(page);
    const attemptCount = (post.attempt_count || 0) + 1;

    await publishingPostRepository.updatePublishingPost(post.id, {
      status: "publishing",
      attempt_count: attemptCount,
      last_attempt_at: new Date(),
      next_retry_at: null,
      error_message: null,
    });

    try {
      const graphResponse = await this.sendPublishRequest(page.fb_page_id, accessToken, {
        pageId: page.id,
        postType: post.post_type as PublishPostInput["postType"],
        message: post.message || undefined,
        link: post.link || undefined,
        mediaUrl: post.media_url || undefined,
        mediaObjectKey: post.media_object_key || undefined,
      }, post.scheduled_publish_time || null);
      const fbPostId = this.extractFacebookPostId(graphResponse);
      const status = post.scheduled_publish_time ? "scheduled" : "published";
      const permalink = fbPostId
        ? await this.resolveFacebookPostPermalink(page.fb_page_id, fbPostId, accessToken)
        : null;

      const updated = await publishingPostRepository.updatePublishingPost(post.id, {
        fb_post_id: fbPostId,
        permalink,
        status,
        graph_response: graphResponse as never,
        error_message: null,
        next_retry_at: null,
      });

      if (status === "published" && fbPostId) {
        try {
          await notificationService.createPublishedNotification(page, updated);
        } catch (notificationError) {
          console.error("[publishing] Failed to create client notification:", notificationError);
        }
      }

      if (status === "published" && post.media_object_key) {
        try {
          await storageService.deleteObject(post.media_object_key);
          await publishingPostRepository.updatePublishingPost(post.id, {
            media_url: null,
            media_object_key: null,
          });
        } catch (error) {
          console.warn("[publishing] Failed to delete temporary media object:", error instanceof Error ? error.message : String(error));
        }
      }

      return updated;
    } catch (error) {
      const publishError = this.normalizePublishError(error);
      const retryable = publishError.retryable;
      const status = retryable && attemptCount < MAX_RETRY_ATTEMPTS ? "failed_retryable" : "failed";
      await publishingPostRepository.updatePublishingPost(post.id, {
        status,
        error_message: publishError.message,
        attempt_count: attemptCount,
        last_attempt_at: new Date(),
        next_retry_at: status === "failed_retryable" ? getNextRetryAt(attemptCount) : null,
      });
      throw publishError;
    }
  }

  private getPublishingToken(page: ConnectedPageEntity): string {
    if (!page.publishing_enabled || !this.hasPublishingPermission(page)) {
      throw new Error("Publishing is not enabled for this page. Reconnect Facebook with pages_manage_posts first.");
    }

    const encryptedToken = page.page_token_encrypted;
    if (!encryptedToken) {
      throw new Error("Page access token is not available. Reconnect Facebook first.");
    }

    return decryptPageToken(encryptedToken);
  }

  private hasPublishingPermission(page: ConnectedPageEntity): boolean {
    const permissions = page.facebook_permissions;
    return Array.isArray(permissions) && permissions.includes(REQUIRED_PUBLISHING_PERMISSION);
  }

  private async sendPublishRequest(
    fbPageId: string,
    accessToken: string,
    input: PublishPostInput,
    scheduledDate: Date | null
  ): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ access_token: accessToken });

    if (scheduledDate) {
      params.append("published", "false");
      params.append("scheduled_publish_time", String(Math.floor(scheduledDate.getTime() / 1000)));
    }

    let path = `/${fbPageId}/feed`;

    if (input.postType === "photo") {
      if (!input.mediaUrl) throw new Error("mediaUrl is required for photo posts");
      path = `/${fbPageId}/photos`;
      params.append("url", input.mediaUrl);
      if (input.message) params.append("caption", input.message);
    } else if (input.postType === "video") {
      if (!input.mediaUrl) throw new Error("mediaUrl is required for video posts");
      path = `/${fbPageId}/videos`;
      params.append("file_url", input.mediaUrl);
      if (input.message) params.append("description", input.message);
    } else {
      if (input.message) params.append("message", input.message);
      if (input.link) params.append("link", input.link);
      if (!input.message && !input.link) throw new Error("message or link is required");
    }

    const response = await this.http.post(path, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    return response.data as Record<string, unknown>;
  }

  private isRetryablePublishError(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
      return false;
    }

    const status = error.response?.status;
    return !status || status === 408 || status === 429 || status >= 500;
  }

  private normalizePublishError(error: unknown): PublishingGraphError {
    if (!axios.isAxiosError(error)) {
      return new PublishingGraphError(error instanceof Error ? error.message : String(error), 500, false);
    }

    const status = error.response?.status || 500;
    const data = error.response?.data as
      | { error?: { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string } }
      | undefined;
    const graphError = data?.error;
    const parts = [
      graphError?.message || error.message,
      graphError?.type ? `type=${graphError.type}` : null,
      graphError?.code !== undefined ? `code=${graphError.code}` : null,
      graphError?.error_subcode !== undefined ? `subcode=${graphError.error_subcode}` : null,
      graphError?.fbtrace_id ? `fbtrace_id=${graphError.fbtrace_id}` : null,
    ].filter(Boolean);

    return new PublishingGraphError(parts.join(" | "), status, this.isRetryablePublishError(error), data);
  }

  private extractFacebookPostId(response: Record<string, unknown>): string | null {
    const id = response.post_id || response.id;
    return typeof id === "string" ? id : null;
  }

  private async resolveFacebookPostPermalink(pageId: string, fbPostId: string, accessToken: string): Promise<string> {
    try {
      const response = await this.http.get(`/${fbPostId}`, {
        params: { access_token: accessToken, fields: "permalink_url" },
      });
      const permalink = response.data?.permalink_url;
      if (typeof permalink === "string" && permalink.length > 0) return permalink;
    } catch (error) {
      console.warn("[publishing] Unable to resolve Facebook permalink:", error instanceof Error ? error.message : String(error));
    }

    const postId = fbPostId.includes("_") ? fbPostId.split("_").pop() : fbPostId;
    return `https://www.facebook.com/${pageId}/posts/${postId}`;
  }
}

export default new FacebookPublishingService();
