import { getDB } from "../config/database";
import { BaseRepository } from "../core/base.repository";
import type { ConnectedPageCreateInput, ConnectedPageEntity } from "../types/domain";

const normalizeFanCount = (fanCount?: bigint | number | string): bigint | number => {
  if (typeof fanCount === "string") {
    try {
      return BigInt(fanCount);
    } catch {
      return 0n;
    }
  }

  return fanCount ?? 0n;
};

export class ConnectedPageRepository extends BaseRepository<ConnectedPageEntity> {
  protected readonly tableName = "connected_pages";

  protected get delegate() {
    return getDB().connectedPage;
  }

  createPage(pageData: ConnectedPageCreateInput): Promise<ConnectedPageEntity> {
    return this.createRecord(pageData);
  }

  // 
  getPagesByFbPageIds(fbPageIds: string[]): Promise<ConnectedPageEntity[]> {
    if (fbPageIds.length === 0) return Promise.resolve([]);
    return getDB().connectedPage.findMany({
      where: { fb_page_id: { in: fbPageIds } },
    });
  }

  getPageById(pageId: string): Promise<ConnectedPageEntity | null> {
    return this.findById(pageId);
  }

  getPageByFbPageId(fbPageId: string): Promise<ConnectedPageEntity | null> {
    return this.findManyRecords({
      where: { fb_page_id: fbPageId },
    }).then((pages) => pages[0] || null);
  }

  getPartnerPages(partnerId: string): Promise<ConnectedPageEntity[]> {
    return this.findManyRecords({
      where: { partner_id: partnerId },
    });
  }

  getAllActivePages(): Promise<ConnectedPageEntity[]> {
    return this.findManyRecords({
      where: { is_active: true },
      orderBy: { created_at: "asc" },
    });
  }

  updatePage(pageId: string, updates: Partial<ConnectedPageCreateInput>): Promise<ConnectedPageEntity> {
    return this.updateRecord({ id: pageId }, updates);
  }

  async upsertPage(pageData: ConnectedPageCreateInput): Promise<ConnectedPageEntity> {
    const data = {
      partner_id: pageData.partner_id,
      fb_page_id: pageData.fb_page_id,
      page_name: pageData.page_name ?? null,
      page_token_encrypted: pageData.page_token_encrypted ?? null,
      picture_url: (pageData as any).picture_url ?? null,
      category: (pageData as any).category ?? null,
      fan_count: normalizeFanCount(pageData.fan_count),
      is_active: pageData.is_active ?? true,
      last_synced_at: pageData.last_synced_at ?? null,
    };

    return getDB().connectedPage.upsert({
      where: {
        partner_id_fb_page_id: {
          partner_id: pageData.partner_id,
          fb_page_id: pageData.fb_page_id,
        },
      } as never,
      create: data,
      update: data,
    });
  }
}

export default new ConnectedPageRepository();
