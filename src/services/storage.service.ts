import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Environment } from "../config/environment";
import crypto from "crypto";
import type { Readable } from "stream";

class StorageService {
  private s3Client: S3Client | null = null;

  constructor() {
    this.init();
  }

  private init() {
    const accountId = Environment.r2AccountId;
    const accessKeyId = Environment.r2AccessKeyId;
    const secretAccessKey = Environment.r2SecretAccessKey;

    if (!accountId || !accessKeyId || !secretAccessKey) {
      console.warn("Cloudflare R2 credentials are not fully configured. File uploads will fail.");
      return;
    }

    this.s3Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  async uploadPdf(buffer: Buffer, filename: string): Promise<string> {
    if (!this.s3Client) {
      throw new Error("Storage service is not configured with R2 credentials.");
    }

    const bucketName = Environment.r2BucketName;
    const fileKey = `reports/${crypto.randomUUID()}-${filename}`;

    try {
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: fileKey,
        Body: buffer,
        ContentType: "application/pdf",
      });

      await this.s3Client.send(command);

      // Cloudflare R2 currently doesn't provide public URLs by default without a custom domain or r2.dev subdomain enabled.
      // We'll return the object key and a generated public URL assuming standard r2.dev or a custom domain is configured.
      // If a custom domain isn't set up, the user will need to enable public access for the bucket.
      // For now, we will construct a generic public URL. The user should map their custom domain if needed.
      return `https://pub-${Environment.r2AccountId}.r2.dev/${fileKey}`; 
    } catch (error) {
      console.error("Failed to upload file to R2:", error);
      throw new Error("Failed to upload report to storage.");
    }
  }

  async uploadPublishingMedia(params: {
    body: Buffer | Readable;
    filename: string;
    contentType: string;
    pageId: string;
  }): Promise<{ key: string; url: string }> {
    if (!this.s3Client) {
      throw new Error("Storage service is not configured with R2 credentials.");
    }

    const safeFilename = params.filename.replace(/[^a-zA-Z0-9._-]/g, "-");
    const key = `publishing-media/${params.pageId}/${crypto.randomUUID()}-${safeFilename}`;

    const command = new PutObjectCommand({
      Bucket: Environment.r2BucketName,
      Key: key,
      Body: params.body,
      ContentType: params.contentType,
    });

    await this.s3Client.send(command);

    return {
      key,
      url: `${Environment.r2PublicBaseUrl}/${key}`,
    };
  }

  async deleteObject(key?: string | null): Promise<void> {
    if (!key || !this.s3Client) {
      return;
    }

    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: Environment.r2BucketName,
        Key: key,
      })
    );
  }
}

export default new StorageService();
