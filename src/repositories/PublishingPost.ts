import { getDB } from "../config/database";
import { BaseRepository } from "../core/base.repository";
import type { PublishingPostCreateInput, PublishingPostEntity } from "../types/domain";

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

  getPagePublishingPosts(pageId: string, status?: string): Promise<PublishingPostEntity[]> {
    return this.findManyRecords({
      where: {
        page_id: pageId,
        ...(status ? { status } : {}),
      },
      orderBy: { created_at: "desc" },
    });
  }

  updatePublishingPost(id: string, updates: Partial<PublishingPostCreateInput>): Promise<PublishingPostEntity> {
    return this.updateRecord({ id }, updates);
  }
}

export default new PublishingPostRepository();
