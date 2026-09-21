import { PeerTransportPort, PeerInfo, TransportMessage } from '../../src/ports/transport.js';

export class MockPeerTransport implements PeerTransportPort {
  public broadcastedMessages: TransportMessage[] = [];
  private messageListeners: Array<(peer: PeerInfo, msg: TransportMessage) => void> = [];
  private peerListeners: Array<(peer: PeerInfo) => void> = [];

  public async start(): Promise<void> {}
  public async stop(): Promise<void> {}

  public async broadcast(message: TransportMessage): Promise<void> {
    this.broadcastedMessages.push(message);
  }

  public onMessage(callback: (peer: PeerInfo, message: TransportMessage) => void): void {
    this.messageListeners.push(callback);
  }

  public onPeerDiscovered(callback: (peer: PeerInfo) => void): void {
    this.peerListeners.push(callback);
  }

  public async simulateIncomingMessage(peer: PeerInfo, message: TransportMessage): Promise<void> {
    for (const listener of this.messageListeners) {
      listener(peer, message);
    }
  }

  public async simulatePeerDiscovery(peer: PeerInfo): Promise<void> {
    for (const listener of this.peerListeners) {
      listener(peer);
    }
  }
}
