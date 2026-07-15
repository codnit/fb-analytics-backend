import { getDB } from "../config/database";
import { BaseRepository } from "../core/base.repository";
import type { PublishingPostCreateInput, PublishingPostEntity } from "../types/domain";
import { PrismaHelpers } from "../utils/prismaHelpers";

export class PublishingPostRepository extends BaseRepository<PublishingPostEntity> {
  protected readonly tableName = "publishing_posts";

  protected get delegate() {
    return getDB().publishingPost;
  }

  createPublishingPost(data: PublishingPostCreateInput): Promise<PublishingPostEntity> {
    return this.createRecord(data);
  }

  getPublishingPostById(id: string): Promise<PublishingPostEntity | null> {
    return this.findById(id);
  }

  async deletePublishingPost(id: string): Promise<void> {
    await this.delegate.delete({ where: { id } });
  }

  getDeletedPublishingPosts(pageId: string): Promise<PublishingPostEntity[]> {
    return this.findManyRecords({ where: { page_id: pageId, status: "deleted" } });
  }

  async getPagePublishingPosts(
    pageId: string,
    status?: string,
    page = 1,
    limit = 10
  ): Promise<{ posts: PublishingPostEntity[]; total: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, Math.max(1, limit));
    const where = {
      page_id: pageId,
      ...(status ? { status } : {}),
    };

    const [posts, total] = await Promise.all([
      this.delegate.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      getDB().publishingPost.count({ where }),
    ]);

    return {
      posts: posts.map((post) => PrismaHelpers.normalizeRecord(post) as PublishingPostEntity),
      total,
    };
  }

  getDueScheduledPosts(limit = 100): Promise<PublishingPostEntity[]> {
    return this.findManyRecords({
      where: {
        status: "scheduled",
        scheduled_publish_time: { lte: new Date() },
        fb_post_id: { not: null },
      },
      orderBy: { scheduled_publish_time: "asc" },
      take: Math.min(500, Math.max(1, limit)),
    });
  }

  updatePublishingPost(id: string, updates: Partial<PublishingPostCreateInput>): Promise<PublishingPostEntity> {
    return this.updateRecord({ id }, updates);
  }
}

export default new PublishingPostRepository();
