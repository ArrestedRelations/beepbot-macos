import type { BeepBotNode } from './node.js';
import type { GossipEnvelope } from './protocols.js';
import { TOPIC_HILL, TOPIC_TASKS, TOPIC_LEDGER, TOPIC_UPDATES, TOPIC_ANCHORS } from './protocols.js';

const ALL_TOPICS = [TOPIC_HILL, TOPIC_TASKS, TOPIC_LEDGER, TOPIC_UPDATES, TOPIC_ANCHORS] as const;

export type MessageHandler = (envelope: GossipEnvelope) => void;

export class GossipRouter {
  private handlers = new Map<string, MessageHandler[]>();
  private started = false;

  constructor(private node: BeepBotNode) {}

  async start(): Promise<void> {
    if (this.started) return;

    const pubsub = this.node.services.pubsub;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pubsub.addEventListener('message', (evt: any) => {
      try {
        const topic = evt.detail.topic;
        const data = new TextDecoder().decode(evt.detail.data);
        const envelope = JSON.parse(data) as GossipEnvelope;

        const handlers = this.handlers.get(topic);
        if (handlers) {
          for (const handler of handlers) {
            try {
              handler(envelope);
            } catch (err) {
              console.error(`[gossip] Handler error on ${topic}:`, (err as Error).message);
            }
          }
        }
      } catch (err) {
        console.error('[gossip] Failed to parse message:', (err as Error).message);
      }
    });

    for (const topic of ALL_TOPICS) {
      pubsub.subscribe(topic);
    }

    this.started = true;
    console.log(`[gossip] Subscribed to ${ALL_TOPICS.length} topics`);
  }

  on(topic: string, handler: MessageHandler): void {
    const existing = this.handlers.get(topic) ?? [];
    existing.push(handler);
    this.handlers.set(topic, existing);
  }

  async publish(topic: string, envelope: GossipEnvelope): Promise<void> {
    const data = new TextEncoder().encode(JSON.stringify(envelope));
    await this.node.services.pubsub.publish(topic, data);
  }

  stop(): void {
    if (!this.started) return;
    const pubsub = this.node.services.pubsub;
    for (const topic of ALL_TOPICS) {
      pubsub.unsubscribe(topic);
    }
    this.handlers.clear();
    this.started = false;
    console.log('[gossip] Unsubscribed from all topics');
  }

  getStats(): { topics: string[]; peerCounts: Record<string, number> } {
    const pubsub = this.node.services.pubsub;
    const peerCounts: Record<string, number> = {};
    for (const topic of ALL_TOPICS) {
      peerCounts[topic] = pubsub.getSubscribers(topic).length;
    }
    return { topics: [...ALL_TOPICS], peerCounts };
  }
}
