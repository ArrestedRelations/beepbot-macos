import { createLibp2p, type Libp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { kadDHT } from '@libp2p/kad-dht';
import { mdns } from '@libp2p/mdns';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import { bootstrap } from '@libp2p/bootstrap';
import { toLibp2pPrivateKey } from '../identity.js';

// BeepBotNode wraps libp2p with typed service accessors
// Using `any` internally due to @libp2p/interface version conflicts across packages
export type BeepBotNode = Libp2p & {
  services: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dht: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pubsub: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    identify: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ping: any;
  };
};

export interface NodeConfig {
  listenPort: number;
  bootstrapPeers: string[];
  enableMdns: boolean;
  dataDir: string;
}

const DEFAULT_CONFIG: NodeConfig = {
  listenPort: 3005,
  bootstrapPeers: [],
  enableMdns: true,
  dataDir: '',
};

export async function createBeepBotNode(config: Partial<NodeConfig> = {}): Promise<BeepBotNode> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const privateKey = await toLibp2pPrivateKey();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const peerDiscovery: any[] = [];
  if (cfg.enableMdns) {
    peerDiscovery.push(mdns());
  }
  if (cfg.bootstrapPeers.length > 0) {
    peerDiscovery.push(bootstrap({ list: cfg.bootstrapPeers }));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const node = await (createLibp2p as any)({
    privateKey,
    addresses: {
      listen: [`/ip4/0.0.0.0/tcp/${cfg.listenPort}`],
    },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      ping: ping(),
      dht: kadDHT({ clientMode: false }),
      pubsub: gossipsub({
        emitSelf: false,
        allowPublishToZeroTopicPeers: true,
      }),
    },
    peerDiscovery,
  });

  return node as BeepBotNode;
}

export function getListenAddrs(node: BeepBotNode): string[] {
  return node.getMultiaddrs().map(m => m.toString());
}
