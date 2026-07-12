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

  async listPublishingPages(): Promise<ConnectedPageEntity[]> {
    const pages = await connectedPageRepository.getAllActivePages();
    return pages.filter((page) => this.hasPublishingPermission(page));
  }

  async publishPost(input: PublishPostInput): Promise<PublishingPostEntity> {
    const page = await this.resolvePage(input.pageId);
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

    return this.attemptPublish(record);
  }

  async listPosts(pageId: string, status?: string): Promise<PublishingPostEntity[]> {
    const page = await this.resolvePage(pageId);
    return publishingPostRepository.getPagePublishingPosts(page.id, status);
  }

  async updatePost(postId: string, input: UpdatePostInput): Promise<PublishingPostEntity> {
    const post = await publishingPostRepository.getPublishingPostById(postId);
    if (!post) throw new Error("Publishing post not found");
    if (!post.fb_post_id) throw new Error("Facebook post id is not available yet");

    const page = await this.resolvePage(post.page_id);
    const accessToken = this.getPublishingToken(page);
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

  async retryPost(postId: string): Promise<PublishingPostEntity> {
    const post = await publishingPostRepository.getPublishingPostById(postId);
    if (!post) throw new Error("Publishing post not found");
    if (!["failed", "failed_retryable"].includes(post.status)) {
      throw new Error("Only failed publishing posts can be retried");
    }

    return this.attemptPublish(post);
  }

  async uploadMedia(input: {
    pageId: string;
    filename: string;
    contentType: string;
    body: Buffer | Readable;
  }): Promise<{ mediaUrl: string; objectKey: string }> {
    const page = await this.resolvePage(input.pageId);
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

  async deletePost(postId: string): Promise<PublishingPostEntity> {
    const post = await publishingPostRepository.getPublishingPostById(postId);
    if (!post) throw new Error("Publishing post not found");

    const page = await this.resolvePage(post.page_id);
    const accessToken = this.getPublishingToken(page);

    if (post.fb_post_id) {
      const params = new URLSearchParams({
        access_token: accessToken,
        method: "delete",
      });
      await this.http.post(`/${post.fb_post_id}`, params, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    }

    return publishingPostRepository.updatePublishingPost(post.id, {
      status: "deleted",
      error_message: null,
    });
  }

  private async resolvePage(pageId: string): Promise<ConnectedPageEntity> {
    const page = isUuid(pageId)
      ? await connectedPageRepository.getPageById(pageId)
      : await connectedPageRepository.getPageByFbPageId(pageId);

    if (!page) throw new Error("Connected page not found");
    return page;
  }

  private async attemptPublish(post: PublishingPostEntity): Promise<PublishingPostEntity> {
    const page = await this.resolvePage(post.page_id);
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

      await storageService.deleteObject(post.media_object_key).catch((error) => {
        console.warn("[publishing] Failed to delete temporary media object:", error instanceof Error ? error.message : String(error));
      });

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
