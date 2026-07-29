import type { NextFunction, Request, Response } from "express";
import { BaseController } from "../core/base.controller";
import postService from "../services/post/post.service";
import postRepository from "../repositories/Post";
import connectedPageRepository from "../repositories/ConnectedPage";
import { ResponseFormatter } from "../utils/formatter";
import { isUuid } from "../utils/uuid";
import type { PostContentType } from "../types/domain";
import { decryptPageToken } from "../utils/pageTokenCrypto";

const POST_CONTENT_TYPES = new Set<PostContentType>(["all", "video", "reel", "photo", "link"]);

export class PostController extends BaseController {
  getPostById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { postId } = req.params as Record<string, string>;
      let realPostId = postId;
      if (isUuid(postId)) {
        const post = await postRepository.getPostById(postId);
        if (post) {
          realPostId = post.fb_post_id;
        }
      }
      const post = await postService.getPostById(realPostId);

      if (!post) {
        return this.notFound(res, "Post not found");
      }

      const formattedPost = ResponseFormatter.formatPost(post.page_id, post as never);
      return this.ok(res, formattedPost, "Post retrieved successfully");
    } catch (error) {
      return next(error);
    }
  };

  // getPagePosts = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  //   try {
  //     const { pageId } = req.params as Record<string, string>;
  //     const { since, until } = req.query as Record<string, string>;
  //     let realPageId = pageId;
  //     if (isUuid(pageId)) {
  //       const page = await connectedPageRepository.getPageById(pageId);
  //       if (page) {
  //         realPageId = page.fb_page_id;
  //       }
  //     }
  //     const posts = await postService.getPagePosts(realPageId, { since, until });
  //     console.log(`[PostController] Found ${posts.length} posts for page ${realPageId}`);
  //     const formattedPosts = posts.map((post) => ResponseFormatter.formatPost(realPageId, post as never));
  //     return this.ok(res, formattedPosts, "Posts retrieved successfully");
  //   } catch (error) {
  //     console.error(`[PostController] Error getting posts for page ${req.params.pageId}:`, error);
  //     return next(error);
  //   }
  // };


  // VERSION 2
  // getPagePosts = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
  //   try {
  //     const { pageId } = req.params as Record<string, string>;
  //     const { since, until } = req.query as Record<string, string>;

  //     let realPageId = pageId;
  //     if (isUuid(pageId)) {
  //       const page = await connectedPageRepository.getPageById(pageId);
  //       if (page) realPageId = page.fb_page_id;
  //     }

  //     const { posts, syncStatus } = await postService.getPagePosts(realPageId, { since, until });

  //     console.log(`[PostController] Found ${posts.length} posts for page ${realPageId} (${syncStatus})`);

  //     const formattedPosts = posts.map((post) => ResponseFormatter.formatPost(realPageId, post as never));

  //     return this.ok(res, { posts: formattedPosts, syncStatus }, "Posts retrieved successfully");
  //   } catch (error) {
  //     console.error(`[PostController] Error getting posts for page ${req.params.pageId}:`, error);
  //     return next(error);
  //   }
  // };

  getPagePosts = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { pageId } = req.params as Record<string, string>;
      const { since, until } = req.query as Record<string, string>;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const requestedContentType = String(req.query.contentType || "all").toLowerCase() as PostContentType;

      if (!POST_CONTENT_TYPES.has(requestedContentType)) {
        return this.badRequest(res, "contentType must be one of: all, video, reel, photo, link");
      }

      let realPageId = pageId;
      if (isUuid(pageId)) {
        const page_ = await connectedPageRepository.getPageById(pageId);
        if (page_) realPageId = page_.fb_page_id;
      }

      const { posts, syncStatus, total } = await postService.getPagePosts(realPageId, {
        since,
        until,
        page,
        limit,
        contentType: requestedContentType,
      });

      console.log(`[PostController] Page ${page} (${posts.length}/${limit}) for ${realPageId} (${syncStatus})`);

      const formattedPosts = posts.map((post) => ResponseFormatter.formatPost(realPageId, post as never));

      // Calculate pagination metadata
      const totalPages = total > 0 ? Math.ceil(total / limit) : 0;
      const pagination = {
        currentPage: page,
        pageSize: limit,
        totalItems: total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      };

      console.log(`[PostController] Pagination: page=${page}, limit=${limit}, total=${total}, totalPages=${totalPages}`);

      return this.ok(
        res,
        { posts: formattedPosts, syncStatus, pagination },
        "Posts retrieved successfully"
      );
    } catch (error) {
      console.error(`[PostController] Error getting posts for page ${req.params.pageId}:`, error);
      return next(error);
    }
  };

  createPost = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const postData = req.body as Record<string, unknown>;
      const post = await postService.createPost(postData as never);
      const formattedPost = ResponseFormatter.formatPost(post.page_id, post as never);
      return this.created(res, formattedPost, "Post created successfully");
    } catch (error) {
      return next(error);
    }
  };

  getPostComments = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { postId } = req.params as Record<string, string>;
      const pageId = req.query.pageId as string;

      if (!pageId) {
        return this.badRequest(res, "pageId is required");
      }

      let realPageId = pageId;
      if (isUuid(pageId)) {
        const page = await connectedPageRepository.getPageById(pageId);
        if (page) {
          realPageId = page.fb_page_id;
        }
      }

      const page = await connectedPageRepository.getPageByFbPageId(realPageId);
      if (!page || !page.page_token_encrypted) {
        return this.notFound(res, "Page or page access token not found");
      }

      const decryptedToken = decryptPageToken(page.page_token_encrypted);
      const fbResponse = await fetch(`https://graph.facebook.com/v25.0/${postId}/comments?access_token=${decryptedToken}`);
      const fbData = await fbResponse.json();

      if (fbData.error) {
        return this.fail(res, fbData.error.message || "Facebook API error");
      }

      return this.ok(res, fbData.data || [], "Comments retrieved successfully");
    } catch (error) {
      console.error(`[PostController] Error getting comments for post ${req.params.postId}:`, error);
      return next(error);
    }
  };

  getPostCommentsCount = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { postId } = req.params as Record<string, string>;

      if (!postId) {
        return this.badRequest(res, "Post ID is required");
      }

      const post = await postRepository.getPostById(postId);

      const formattedData = {
        post_id: postId,
        metric_name: "comments.summary.total_count",
        metric_value: post?.comments_count || 0,
      };

      return this.ok(res, formattedData, "Post comments count retrieved successfully");
    } catch (error) {
      return next(error);
    }
  };

  getPostSharesCount = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
      const { postId } = req.params as Record<string, string>;

      if (!postId) {
        return this.badRequest(res, "Post ID is required");
      }

      const post = await postRepository.getPostById(postId);

      const formattedData = {
        post_id: postId,
        metric_name: "shares.count",
        metric_value: post?.shares_count || 0,
      };

      return this.ok(res, formattedData, "Post shares count retrieved successfully");
    } catch (error) {
      return next(error);
    }
  };
}

export default new PostController();
