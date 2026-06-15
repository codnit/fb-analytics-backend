import { getDB } from "../config/database";
import { BaseRepository } from "../core/base.repository";
import type { GraphQueryOptions, PostCreateInput, PostEntity } from "../types/domain";
import { isUuid } from "../utils/uuid";

const normalizeRangeBoundary = (value: string, boundary: "since" | "until"): Date => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const suffix = boundary === "since" ? "T00:00:00.000Z" : "T23:59:59.999Z";
    return new Date(`${value}${suffix}`);
  }

  return new Date(value);
};

export class PostRepository extends BaseRepository<PostEntity> {
  protected readonly tableName = "posts";

  protected get delegate() {
    return getDB().post;
  }

  createPost(postData: PostCreateInput): Promise<PostEntity> {
    return this.createRecord(postData);
  }

  // get posts by ids (handle both uuid and fb_post_id)
  getPostsByIds = async (ids: string[]): Promise<PostEntity[]> => {
    if (ids.length === 0) return [];

    const uuidIds = ids.filter(id => isUuid(id));
    const fbIds = ids.filter(id => !isUuid(id));

    const [byUuid, byFbId] = await Promise.all([
      uuidIds.length > 0
        ? getDB().post.findMany({ where: { id: { in: uuidIds } } })
        : [],
      fbIds.length > 0
        ? getDB().post.findMany({ where: { fb_post_id: { in: fbIds } } })
        : [],
    ]);

    return [...byUuid, ...byFbId];
  };

  getPostById(postId: string): Promise<PostEntity | null> {
    if (postId.includes("_") || postId.length > 36) {
      return this.getPostByFbPostId(postId);
    }
    return this.findById(postId);
  }

  getPostByFbPostId(fbPostId: string): Promise<PostEntity | null> {
    return this.findManyRecords({
      where: { fb_post_id: fbPostId },
    }).then((posts) => posts[0] || null);
  }

  getPagePosts(pageId: string, options: Pick<GraphQueryOptions, "since" | "until"> = {}): Promise<PostEntity[]> {
    const { since, until } = options;
    const created_time =
      since || until
        ? {
          ...(since ? { gte: normalizeRangeBoundary(since, "since") } : {}),
          ...(until ? { lte: normalizeRangeBoundary(until, "until") } : {}),
        }
        : undefined;

    return this.findManyRecords({
      where: {
        page_id: pageId,
        ...(created_time ? { created_time } : {}),
      },
      orderBy: { created_time: "desc" },
    });
  }

  updatePost(postId: string, updates: Partial<PostCreateInput>): Promise<PostEntity> {
    return this.updateRecord({ id: postId }, updates);
  }

  async upsertPost(postData: PostCreateInput): Promise<PostEntity> {
    return getDB().post.upsert({
      where: {
        page_id_fb_post_id: {
          page_id: postData.page_id,
          fb_post_id: postData.fb_post_id,
        },
      } as never,
      create: postData,
      update: postData,
    });
  }
}

export default new PostRepository();
