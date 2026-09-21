import { SyncEvent } from '../domain/types.js';

export interface PeerInfo {
  nodeId: string;
  address: string;
  port: number;
  lastSeen: number;
}

export type TransportMessage =
  | { type: 'HANDSHAKE'; nodeId: string; knownEventsCount: number }
  | { type: 'SYNC_REQUEST'; sinceTimestamp: number }
  | { type: 'SYNC_RESPONSE'; events: SyncEvent[] }
  | { type: 'EVENT_BROADCAST'; event: SyncEvent };

export interface PeerTransportPort {
  /**
   * Start discovering peers and listening for incoming messages.
   */
  start(): Promise<void>;

  /**
   * Stop transport and release resources.
   */
  stop(): Promise<void>;

  /**
   * Broadcast a message or event to all discovered LAN peers.
   */
  broadcast(message: TransportMessage): Promise<void>;

  /**
   * Register listener for incoming P2P messages.
   */
  onMessage(callback: (peer: PeerInfo, message: TransportMessage) => void): void;

  /**
   * Register listener for discovered peers.
   */
  onPeerDiscovered(callback: (peer: PeerInfo) => void): void;
}
