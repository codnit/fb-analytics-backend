import { BaseService } from "../../core/base.service";
import connectedPageRepository from "../../repositories/ConnectedPage";
import syncJobRepository from "../../repositories/SyncJob";
import type { ConnectedPageCreateInput, ConnectedPageEntity } from "../../types/domain";

export class PageService extends BaseService {
  constructor() {
    super("PageService");
  }

  createConnectedPage(pageData: ConnectedPageCreateInput): Promise<ConnectedPageEntity> {
    return connectedPageRepository.upsertPage(pageData);
  }

  getPageById(pageId: string): Promise<ConnectedPageEntity | null> {
    return connectedPageRepository.getPageById(pageId);
  }

  async getPartnerPages(partnerId: string): Promise<ConnectedPageEntity[]> {
    const pages = await connectedPageRepository.getPartnerPages(partnerId);
    console.log("The Pages are: ", pages);
    const latestJobsByPage = await syncJobRepository.getLatestCompletedByPageIds(pages.map((page) => page.id));

    return pages.map((page) => ({
      ...page,
      latest_sync_completed_at: latestJobsByPage.get(page.id)?.completed_at || null,
    }));
  }

  updatePage(pageId: string, updates: Partial<ConnectedPageCreateInput>): Promise<ConnectedPageEntity> {
    return connectedPageRepository.updatePage(pageId, updates);
  }
}

export default new PageService();
