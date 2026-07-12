import Redis from "ioredis";
import { Environment } from "../../config/environment";

export type NotificationEventPayload = {
  id: string;
  type: string;
  title: string;
  message?: string | null;
  page_name?: string | null;
  post_url?: string | null;
  is_read: boolean;
  read_at?: Date | null;
  created_at: Date;
};

type NotificationListener = (payload: NotificationEventPayload) => void;

const channelPrefix = "notifications:partner:";

class NotificationEventBus {
  private listeners = new Map<string, Set<NotificationListener>>();
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private redisInitialization: Promise<void> | null = null;

  async connect(): Promise<void> {
    if (!Environment.redisUrl) return;
    if (this.redisInitialization) return this.redisInitialization;

    this.redisInitialization = (async () => {
      this.publisher = new Redis(Environment.redisUrl as string);
      this.subscriber = new Redis(Environment.redisUrl as string);
      this.subscriber.on("error", (error) => {
        console.error("[notifications] Redis subscriber error:", error.message);
      });
      this.publisher.on("error", (error) => {
        console.error("[notifications] Redis publisher error:", error.message);
      });
      this.subscriber.on("pmessage", (_pattern, channel, message) => {
        const partnerId = channel.slice(channelPrefix.length);
        try {
          this.emitLocal(partnerId, JSON.parse(message) as NotificationEventPayload);
        } catch (error) {
          console.error("[notifications] Invalid Redis event payload:", error);
        }
      });
      await this.subscriber.psubscribe(`${channelPrefix}*`);
    })().catch((error) => {
      this.redisInitialization = null;
      this.publisher = null;
      this.subscriber = null;
      throw error;
    });

    return this.redisInitialization;
  }

  subscribe(partnerId: string, listener: NotificationListener): () => void {
    const partnerListeners = this.listeners.get(partnerId) || new Set<NotificationListener>();
    partnerListeners.add(listener);
    this.listeners.set(partnerId, partnerListeners);

    return () => {
      partnerListeners.delete(listener);
      if (partnerListeners.size === 0) this.listeners.delete(partnerId);
    };
  }

  async publish(partnerId: string, payload: NotificationEventPayload): Promise<void> {
    if (!Environment.redisUrl) {
      this.emitLocal(partnerId, payload);
      return;
    }

    try {
      await this.connect();
      await this.publisher?.publish(`${channelPrefix}${partnerId}`, JSON.stringify(payload));
    } catch (error) {
      console.error("[notifications] Redis publish failed; using local delivery:", error);
      this.emitLocal(partnerId, payload);
    }
  }

  private emitLocal(partnerId: string, payload: NotificationEventPayload): void {
    this.listeners.get(partnerId)?.forEach((listener) => listener(payload));
  }
}

export const notificationEventBus = new NotificationEventBus();
