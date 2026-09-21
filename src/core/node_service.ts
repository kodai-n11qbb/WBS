import { EventRepositoryPort } from '../ports/repository.js';
import { PeerTransportPort, PeerInfo, TransportMessage } from '../ports/transport.js';
import { SyncEngine } from '../domain/sync_engine.js';
import { ProjectState, SyncEvent, TaskStatus } from '../domain/types.js';
import { crypto } from './crypto_util.js';

export interface NodeServiceDependencies {
  nodeId: string;
  repository: EventRepositoryPort;
  transport: PeerTransportPort;
  syncEngine: SyncEngine;
}

export class NodeService {
  private nodeId: string;
  private repository: EventRepositoryPort;
  private transport: PeerTransportPort;
  private syncEngine: SyncEngine;
  private sequenceCounter: number = 0;

  constructor(deps: NodeServiceDependencies) {
    this.nodeId = deps.nodeId;
    this.repository = deps.repository;
    this.transport = deps.transport;
    this.syncEngine = deps.syncEngine;

    this.setupTransportListeners();
  }

  private setupTransportListeners(): void {
    this.transport.onMessage(async (peer: PeerInfo, msg: TransportMessage) => {
      await this.handleIncomingMessage(peer, msg);
    });

    this.transport.onPeerDiscovered(async (peer: PeerInfo) => {
      // Send handshake on peer discovery
      const allEvents = await this.repository.getAllEvents();
      await this.transport.broadcast({
        type: 'HANDSHAKE',
        nodeId: this.nodeId,
        knownEventsCount: allEvents.length,
      });
    });
  }

  public async start(): Promise<void> {
    await this.transport.start();
  }

  public async stop(): Promise<void> {
    await this.transport.stop();
  }

  public getNodeId(): string {
    return this.nodeId;
  }

  public async createProject(name: string): Promise<SyncEvent> {
    const projectId = crypto.randomUUID();
    const event: SyncEvent = {
      id: crypto.randomUUID(),
      projectId,
      authorNodeId: this.nodeId,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
      type: 'PROJECT_CREATED',
      payload: { name },
    };

    await this.repository.saveEvent(event);
    await this.transport.broadcast({ type: 'EVENT_BROADCAST', event });
    return event;
  }

  public async createTask(
    projectId: string,
    title: string,
    status: TaskStatus = 'TODO'
  ): Promise<SyncEvent> {
    const taskId = crypto.randomUUID();
    const event: SyncEvent = {
      id: crypto.randomUUID(),
      projectId,
      authorNodeId: this.nodeId,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
      type: 'TASK_CREATED',
      payload: { taskId, title, status },
    };

    await this.repository.saveEvent(event);
    await this.transport.broadcast({ type: 'EVENT_BROADCAST', event });
    return event;
  }

  public async updateTaskStatus(
    projectId: string,
    taskId: string,
    status: TaskStatus
  ): Promise<SyncEvent> {
    const event: SyncEvent = {
      id: crypto.randomUUID(),
      projectId,
      authorNodeId: this.nodeId,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
      type: 'TASK_STATUS_UPDATED',
      payload: { taskId, status },
    };

    await this.repository.saveEvent(event);
    await this.transport.broadcast({ type: 'EVENT_BROADCAST', event });
    return event;
  }

  public async getProjectState(projectId: string): Promise<ProjectState> {
    const allEvents = await this.repository.getAllEvents();
    const projectEvents = allEvents.filter((e) => e.projectId === projectId);
    return this.syncEngine.reduceEvents(projectEvents);
  }

  public async getAllEvents(): Promise<SyncEvent[]> {
    return this.repository.getAllEvents();
  }

  public async handleIncomingMessage(peer: PeerInfo, msg: TransportMessage): Promise<void> {
    switch (msg.type) {
      case 'EVENT_BROADCAST':
        await this.repository.saveEvent(msg.event);
        break;

      case 'HANDSHAKE': {
        const events = await this.repository.getAllEvents();
        if (events.length > 0) {
          await this.transport.broadcast({
            type: 'SYNC_RESPONSE',
            events,
          });
        }
        break;
      }

      case 'SYNC_REQUEST': {
        const sinceEvents = await this.repository.getEventsSince(msg.sinceTimestamp);
        if (sinceEvents.length > 0) {
          await this.transport.broadcast({
            type: 'SYNC_RESPONSE',
            events: sinceEvents,
          });
        }
        break;
      }

      case 'SYNC_RESPONSE':
        await this.repository.saveEvents(msg.events);
        break;
    }
  }
}
