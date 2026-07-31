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
  static getPageByFbPageId(pageId: string) {
    throw new Error("Method not implemented.");
  }
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

  async markFacebookReauthRequired(
    pageId: string,
    reason = "facebook_page_token_invalid"
  ): Promise<ConnectedPageEntity> {
    return this.delegate.update({
      where: { id: pageId },
      data: {
        facebook_reauth_required: true,
        facebook_reauth_required_at: new Date(),
        facebook_reauth_reason: reason,
      },
    });
  }

  async markFacebookReauthRequiredByFbPageId(
    fbPageId: string,
    partnerId: string,
    reason = "facebook_page_token_invalid"
  ): Promise<number> {
    const result = await this.delegate.updateMany({
      where: {
        fb_page_id: fbPageId,
        partner_id: partnerId,
      },
      data: {
        facebook_reauth_required: true,
        facebook_reauth_required_at: new Date(),
        facebook_reauth_reason: reason,
      },
    });

    return result.count;
  }

  async clearFacebookReauthRequired(
    pageId: string,
    syncStartedAt?: Date
  ): Promise<number> {
    const result = await this.delegate.updateMany({
      where: {
        id: pageId,
        facebook_reauth_required: true,
        ...(syncStartedAt
          ? {
            OR: [
              { facebook_reauth_required_at: null },
              { facebook_reauth_required_at: { lte: syncStartedAt } },
            ],
          }
          : {}),
      },
      data: {
        facebook_reauth_required: false,
        facebook_reauth_required_at: null,
        facebook_reauth_reason: null,
      },
    });

    return result.count;
  }

  async clearFacebookReauthRequiredByFbPageId(
    fbPageId: string,
    partnerId: string,
    validationStartedAt?: Date
  ): Promise<number> {
    const result = await this.delegate.updateMany({
      where: {
        fb_page_id: fbPageId,
        partner_id: partnerId,
        facebook_reauth_required: true,
        ...(validationStartedAt
          ? {
            OR: [
              { facebook_reauth_required_at: null },
              { facebook_reauth_required_at: { lte: validationStartedAt } },
            ],
          }
          : {}),
      },
      data: {
        facebook_reauth_required: false,
        facebook_reauth_required_at: null,
        facebook_reauth_reason: null,
      },
    });

    return result.count;
  }

  async updatePublishingForFbPage(
    fbPageId: string,
    updates: Pick<
      ConnectedPageCreateInput,
      | "publishing_enabled"
      | "publishing_granted_at"
      | "publishing_granted_by"
      | "facebook_permissions"
      | "permissions_checked_at"
    >
  ): Promise<number> {
    const result = await getDB().connectedPage.updateMany({
      where: { fb_page_id: fbPageId },
      data: updates,
    });

    return result.count;
  }

  async upsertPage(pageData: ConnectedPageCreateInput): Promise<ConnectedPageEntity> {
    const createData = {
      partner_id: pageData.partner_id,
      fb_page_id: pageData.fb_page_id,
      page_name: pageData.page_name ?? null,
      page_token_encrypted: pageData.page_token_encrypted ?? null,
      publishing_enabled: pageData.publishing_enabled ?? false,
      publishing_granted_at: pageData.publishing_granted_at ?? null,
      publishing_granted_by: pageData.publishing_granted_by ?? null,
      facebook_permissions: pageData.facebook_permissions ?? null,
      permissions_checked_at: pageData.permissions_checked_at ?? null,
      picture_url: (pageData as any).picture_url ?? null,
      category: (pageData as any).category ?? null,
      fan_count: normalizeFanCount(pageData.fan_count),
      is_active: pageData.is_active ?? true,
      last_synced_at: pageData.last_synced_at ?? null,
      facebook_reauth_required: pageData.facebook_reauth_required ?? false,
      facebook_reauth_required_at: pageData.facebook_reauth_required_at ?? null,
      facebook_reauth_reason: pageData.facebook_reauth_reason ?? null,
    };

    const updateData = {
      partner_id: pageData.partner_id,
      fb_page_id: pageData.fb_page_id,
      page_name: pageData.page_name ?? null,
      page_token_encrypted: pageData.page_token_encrypted ?? null,
      ...(pageData.publishing_enabled !== undefined ? { publishing_enabled: pageData.publishing_enabled } : {}),
      ...(pageData.publishing_granted_at !== undefined ? { publishing_granted_at: pageData.publishing_granted_at } : {}),
      ...(pageData.publishing_granted_by !== undefined ? { publishing_granted_by: pageData.publishing_granted_by } : {}),
      ...(pageData.facebook_permissions !== undefined ? { facebook_permissions: pageData.facebook_permissions } : {}),
      ...(pageData.permissions_checked_at !== undefined ? { permissions_checked_at: pageData.permissions_checked_at } : {}),
      picture_url: (pageData as any).picture_url ?? null,
      category: (pageData as any).category ?? null,
      fan_count: normalizeFanCount(pageData.fan_count),
      is_active: pageData.is_active ?? true,
      last_synced_at: pageData.last_synced_at ?? null,
      ...(pageData.facebook_reauth_required !== undefined
        ? { facebook_reauth_required: pageData.facebook_reauth_required }
        : {}),
      ...(pageData.facebook_reauth_required_at !== undefined
        ? { facebook_reauth_required_at: pageData.facebook_reauth_required_at }
        : {}),
      ...(pageData.facebook_reauth_reason !== undefined
        ? { facebook_reauth_reason: pageData.facebook_reauth_reason }
        : {}),
    };

    return getDB().connectedPage.upsert({
      where: {
        partner_id_fb_page_id: {
          partner_id: pageData.partner_id,
          fb_page_id: pageData.fb_page_id,
        },
      } as never,
      create: createData,
      update: updateData,
    });
  }
}

export default new ConnectedPageRepository();
