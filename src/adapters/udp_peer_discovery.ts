import dgram from 'node:dgram';
import { PeerTransportPort, PeerInfo, TransportMessage } from '../ports/transport.js';

export interface UdpTransportConfig {
  nodeId: string;
  port: number;
  multicastAddress?: string;
}

export class UdpPeerTransport implements PeerTransportPort {
  private nodeId: string;
  private port: number;
  private multicastAddr: string;
  private socket: dgram.Socket | null = null;
  private messageCallbacks: Array<(peer: PeerInfo, msg: TransportMessage) => void> = [];
  private peerCallbacks: Array<(peer: PeerInfo) => void> = [];
  private knownPeers: Map<string, PeerInfo> = new Map();

  constructor(config: UdpTransportConfig) {
    this.nodeId = config.nodeId;
    this.port = config.port;
    this.multicastAddr = config.multicastAddress || '239.255.255.250';
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        this.socket.on('error', (err) => {
          console.error('[UDP Transport Error]', err);
        });

        this.socket.on('message', (msg, rinfo) => {
          this.handlePacket(msg, rinfo);
        });

        this.socket.bind(this.port, () => {
          if (this.socket) {
            try {
              this.socket.setBroadcast(true);
              this.socket.addMembership(this.multicastAddr);
            } catch (e) {
              // Multicast membership might fail on loopback only, fallback to broadcast
            }
          }
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public async stop(): Promise<void> {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  public async broadcast(message: TransportMessage): Promise<void> {
    if (!this.socket) return;
    const packet = JSON.stringify({
      senderNodeId: this.nodeId,
      message,
    });
    const buffer = Buffer.from(packet);

    return new Promise((resolve) => {
      this.socket?.send(buffer, 0, buffer.length, this.port, this.multicastAddr, () => {
        resolve();
      });
    });
  }

  public onMessage(callback: (peer: PeerInfo, message: TransportMessage) => void): void {
    this.messageCallbacks.push(callback);
  }

  public onPeerDiscovered(callback: (peer: PeerInfo) => void): void {
    this.peerCallbacks.push(callback);
  }

  private handlePacket(msgBuffer: Buffer, rinfo: dgram.RemoteInfo): void {
    try {
      const data = JSON.parse(msgBuffer.toString('utf-8'));
      if (!data || data.senderNodeId === this.nodeId) {
        // Ignore self packets
        return;
      }

      const peer: PeerInfo = {
        nodeId: data.senderNodeId,
        address: rinfo.address,
        port: rinfo.port,
        lastSeen: Date.now(),
      };

      if (!this.knownPeers.has(peer.nodeId)) {
        this.knownPeers.set(peer.nodeId, peer);
        for (const cb of this.peerCallbacks) {
          cb(peer);
        }
      }

      for (const cb of this.messageCallbacks) {
        cb(peer, data.message);
      }
    } catch (e) {
      // Ignore malformed packets
    }
  }
}
