const crypto = require("crypto");
const { disconnectDB, getDB } = require("../src/config/database");
const { hashFacebookDeletionIdentifier } = require("../src/utils/facebookDataDeletion");
const facebookDataDeletionService = require("../src/services/facebook/data-deletion.service").default;
const { notificationEventBus } = require("../src/services/notifications/notification.events");

const appSecret = process.env.FB_APP_SECRET;
const describeWithDatabase = process.env.RUN_DB_INTEGRATION_TESTS === "1" && appSecret
  ? describe
  : describe.skip;

describeWithDatabase("Facebook data deletion database flow", () => {
  const unknownFacebookUserId = `integration-test-${Date.now()}`;
  const userIdHash = hashFacebookDeletionIdentifier(unknownFacebookUserId, appSecret || "");

  beforeAll(() => {
    jest.spyOn(notificationEventBus, "publish").mockResolvedValue();
  });

  afterAll(async () => {
    await getDB().facebookDataDeletionRequest.deleteMany({
      where: { user_id_hash: userIdHash },
    });
    await disconnectDB();
    jest.restoreAllMocks();
  });

  test("completes safely when Meta's user ID is not stored", async () => {
    const result = await facebookDataDeletionService.deleteFacebookDataForUser(
      unknownFacebookUserId,
      appSecret
    );

    expect(result.confirmationCode).toMatch(/^[a-f0-9]{32}$/);
    expect(result.status).toBe("completed");
    expect(result.statusMessage).toContain("No stored PIB partner account");

    const storedStatus = await facebookDataDeletionService.getStatus(result.confirmationCode);
    expect(storedStatus).toEqual(result);
  });

  test("hard-deletes the partner account and every associated data record", async () => {
    const suffix = crypto.randomUUID();
    const partnerId = crypto.randomUUID();
    const facebookUserId = `test-facebook-user-${suffix}`;
    const connectedPageId = crypto.randomUUID();
    const facebookPageId = `test-facebook-page-${suffix}`;
    const postId = crypto.randomUUID();
    const facebookPostId = `${facebookPageId}_post`;
    const publishingPostId = crypto.randomUUID();
    const thirdPartyDataId = crypto.randomUUID();
    const requestHash = hashFacebookDeletionIdentifier(facebookUserId, appSecret || "");
    const db = getDB();

    try {
      await db.partner.create({ data: {
        id: partnerId,
        user_id: facebookUserId,
        name: "Preserved Partner",
        email: `preserved-${suffix}@example.com`,
        company: "Preserved Company",
        facebook_user_token_encrypted: "encrypted-user-token",
      } });
      await db.connectedPage.create({ data: {
        id: connectedPageId,
        partner_id: partnerId,
        fb_page_id: facebookPageId,
        page_name: "Facebook Page Name",
        page_token_encrypted: "encrypted-page-token",
        fan_count: 123,
        is_active: true,
      } });
      await db.post.create({ data: {
        id: postId,
        page_id: facebookPageId,
        fb_post_id: facebookPostId,
        message: "Facebook-provided post",
      } });
      await db.pageInsight.create({ data: {
        page_id: facebookPageId,
        metric_name: "page_impressions",
        metric_value: 10,
      } });
      await db.cmEarningsPage.create({ data: {
        page_id: facebookPageId,
        earnings_amount: "10.00",
      } });
      await db.postInsight.create({ data: {
        post_id: facebookPostId,
        metric_name: "post_impressions",
        metric_value: 5,
      } });
      await db.cmEarningsPost.create({ data: {
        post_id: facebookPostId,
        earnings_amount: "2.00",
      } });
      await db.thirdPartyData.create({ data: {
        id: thirdPartyDataId,
        page_id: connectedPageId,
        post_id: postId,
        data_type: "custom_partner_note",
        value: { note: "keep this custom data" },
      } });
      await db.publishingPost.create({ data: {
        id: publishingPostId,
        page_id: connectedPageId,
        fb_page_id: facebookPageId,
        fb_post_id: facebookPostId,
        permalink: `https://facebook.com/${facebookPostId}`,
        post_type: "photo",
        message: "Keep this custom publishing message",
        media_url: "https://example.com/custom-media.jpg",
        status: "scheduled",
        graph_response: { id: facebookPostId },
      } });
      await db.notification.create({ data: {
        recipient_partner_id: partnerId,
        connected_page_id: connectedPageId,
        publishing_post_id: publishingPostId,
        title: "Facebook notification",
      } });
      await db.syncJob.create({ data: {
        page_id: connectedPageId,
        job_type: "test_sync",
      } });

      const result = await facebookDataDeletionService.deleteFacebookDataForUser(
        facebookUserId,
        appSecret
      );

      expect(result.status).toBe("completed");

      expect(await db.partner.count({ where: { id: partnerId } })).toBe(0);
      expect(await db.connectedPage.count({ where: { id: connectedPageId } })).toBe(0);
      expect(await db.post.count({ where: { id: postId } })).toBe(0);
      expect(await db.pageInsight.count({ where: { page_id: facebookPageId } })).toBe(0);
      expect(await db.cmEarningsPage.count({ where: { page_id: facebookPageId } })).toBe(0);
      expect(await db.postInsight.count({ where: { post_id: facebookPostId } })).toBe(0);
      expect(await db.cmEarningsPost.count({ where: { post_id: facebookPostId } })).toBe(0);
      expect(await db.notification.count({ where: { connected_page_id: connectedPageId } })).toBe(0);
      expect(await db.syncJob.count({ where: { page_id: connectedPageId } })).toBe(0);

      expect(await db.thirdPartyData.count({ where: { id: thirdPartyDataId } })).toBe(0);
      expect(await db.publishingPost.count({ where: { id: publishingPostId } })).toBe(0);
    } finally {
      await db.notification.deleteMany({ where: { connected_page_id: connectedPageId } });
      await db.syncJob.deleteMany({ where: { page_id: connectedPageId } });
      await db.publishingPost.deleteMany({ where: { id: publishingPostId } });
      await db.thirdPartyData.deleteMany({ where: { id: thirdPartyDataId } });
      await db.postInsight.deleteMany({ where: { post_id: { in: [postId, facebookPostId] } } });
      await db.cmEarningsPost.deleteMany({ where: { post_id: { in: [postId, facebookPostId] } } });
      await db.post.deleteMany({ where: { id: postId } });
      await db.pageInsight.deleteMany({ where: { page_id: { in: [connectedPageId, facebookPageId] } } });
      await db.cmEarningsPage.deleteMany({ where: { page_id: { in: [connectedPageId, facebookPageId] } } });
      await db.connectedPage.deleteMany({ where: { id: connectedPageId } });
      await db.partner.deleteMany({ where: { id: partnerId } });
      await db.facebookDataDeletionRequest.deleteMany({ where: { user_id_hash: requestHash } });
    }
  });
});
