import fs from "fs/promises";
import path from "path";
import axios from "axios";

export const dumpApiData = async (prefix: string, data: unknown) => {
  try {
    const webhookUrl = process.env.DEBUG_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await axios.post(webhookUrl, {
          prefix,
          timestamp: new Date().toISOString(),
          data
        });
        console.log(`[debug] Sent API data to webhook for ${prefix}`);
      } catch (err) {
        console.error(`[debug] Failed to send API data to webhook for ${prefix}:`, err instanceof Error ? err.message : err);
      }
    }

    const dir = path.join(process.cwd(), "logs", "api_dumps");
    await fs.mkdir(dir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${prefix}_${timestamp}.json`;
    const filepath = path.join(dir, filename);

    await fs.writeFile(filepath, JSON.stringify(data, null, 2), "utf8");
    console.log(`[debug] Dumped API data to ${filepath}`);
  } catch (error) {
    console.error(`[debug] Failed to dump API data for ${prefix}:`, error);
  }
};
