import { Worker, Job } from "bullmq";
import { getRedisConnectionUrl } from "../config/redis";
import connectedPageRepository from "../repositories/ConnectedPage";
import insightsService from "../services/insights.service";
import postSyncService from "../services/facebook/post.sync.service";
import { resolveStoredToken } from "../utils/insight-cache.helpers";
import { isFacebookTokenError } from "../utils/facebookAuthError";

type PostMetadataJobData = {
  pageId: string;
  fbPostId: string;
};

export const postMetadataSyncWorker = new Worker(
  "sync-post-metadata",
  async (job: Job<PostMetadataJobData>) => {
    const { pageId, fbPostId } = job.data;
    const connectedPage = await connectedPageRepository.getPageByFbPageId(pageId);
    const accessToken = resolveStoredToken(connectedPage?.page_token_encrypted);

    if (!accessToken) {
      if (connectedPage) {
        await connectedPageRepository.markFacebookReauthRequired(connectedPage.id, "missing_page_token");
      }
      throw new Error(`No stored token found for page ${pageId}`);
    }

    let response;
    try {
      response = await insightsService.getPostMetadata(fbPostId, {
        access_token: accessToken,
      });
    } catch (error) {
      if (connectedPage && isFacebookTokenError(error)) {
        await connectedPageRepository.markFacebookReauthRequired(connectedPage.id);
      }
      throw error;
    }
    const post = response.data;

    await postSyncService.syncPost({
      page_id: pageId,
      fb_post_id: post.id || fbPostId,
      message: post.message,
      type: post.status_type,
      full_picture: post.full_picture || null,
      comments_count: post.comments?.summary?.total_count || 0,
      shares_count: post.shares?.count || 0,
      permalink: post.permalink_url,
      created_time: post.created_time,
    });
  },
  {
    connection: {
      url: getRedisConnectionUrl(),
    },
    concurrency: 5,
  }
);
