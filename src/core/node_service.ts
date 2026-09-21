import { EventRepositoryPort } from '../ports/repository.js';
import { PeerTransportPort, PeerInfo, TransportMessage } from '../ports/transport.js';
import { SyncEngine } from '../domain/sync_engine.js';
import { TaskValidatorPort, StructuredTaskValidator } from '../domain/task_validator.js';
import { ProjectState, SyncEvent, TaskStatus, TaskPriority, DefinitionOfDoneItem } from '../domain/types.js';
import { crypto } from './crypto_util.js';

export interface CreateTaskInput {
  parentId?: string | null;
  title: string;
  intent?: string;
  definitionOfDone?: DefinitionOfDoneItem[];
  priority?: TaskPriority;
  status?: TaskStatus;
  orderIndex?: number;
}

export interface NodeServiceDependencies {
  nodeId: string;
  repository: EventRepositoryPort;
  transport: PeerTransportPort;
  syncEngine: SyncEngine;
  validator?: TaskValidatorPort;
}

export class NodeService {
  private nodeId: string;
  private repository: EventRepositoryPort;
  private transport: PeerTransportPort;
  private syncEngine: SyncEngine;
  private validator: TaskValidatorPort;
  private sequenceCounter: number = 0;

  constructor(deps: NodeServiceDependencies) {
    this.nodeId = deps.nodeId;
    this.repository = deps.repository;
    this.transport = deps.transport;
    this.syncEngine = deps.syncEngine;
    this.validator = deps.validator || new StructuredTaskValidator();

    this.setupTransportListeners();
  }

  private setupTransportListeners(): void {
    this.transport.onMessage(async (peer: PeerInfo, msg: TransportMessage) => {
      await this.handleIncomingMessage(peer, msg);
    });

    this.transport.onPeerDiscovered(async () => {
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

  public async createTask(projectId: string, input: CreateTaskInput): Promise<SyncEvent> {
    const validation = this.validator.validateCreation(input);
    if (!validation.valid) {
      throw new Error(`タスク作成失敗: ${validation.errors.join(' / ')}`);
    }

    const taskId = crypto.randomUUID();
    const event: SyncEvent = {
      id: crypto.randomUUID(),
      projectId,
      authorNodeId: this.nodeId,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
      type: 'TASK_CREATED',
      payload: {
        taskId,
        parentId: input.parentId || null,
        title: input.title.trim(),
        intent: input.intent ? input.intent.trim() : '',
        definitionOfDone: input.definitionOfDone || [],
        priority: input.priority || 'MEDIUM',
        status: input.status || 'TODO',
        orderIndex: typeof input.orderIndex === 'number' ? input.orderIndex : Date.now(),
      },
    };

    await this.repository.saveEvent(event);
    await this.transport.broadcast({ type: 'EVENT_BROADCAST', event });
    return event;
  }

  public async updateTaskStatus(
    projectId: string,
    taskId: string,
    status: TaskStatus,
    newOrderIndex?: number
  ): Promise<SyncEvent> {
    const event: SyncEvent = {
      id: crypto.randomUUID(),
      projectId,
      authorNodeId: this.nodeId,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
      type: 'TASK_STATUS_UPDATED',
      payload: { taskId, status, newOrderIndex },
    };

    await this.repository.saveEvent(event);
    await this.transport.broadcast({ type: 'EVENT_BROADCAST', event });
    return event;
  }

  public async reorderTask(
    projectId: string,
    taskId: string,
    newOrderIndex: number
  ): Promise<SyncEvent> {
    const event: SyncEvent = {
      id: crypto.randomUUID(),
      projectId,
      authorNodeId: this.nodeId,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
      type: 'TASK_REORDERED',
      payload: { taskId, newOrderIndex },
    };

    await this.repository.saveEvent(event);
    await this.transport.broadcast({ type: 'EVENT_BROADCAST', event });
    return event;
  }

  public async changeTaskParent(
    projectId: string,
    taskId: string,
    newParentId: string | null
  ): Promise<SyncEvent> {
    const event: SyncEvent = {
      id: crypto.randomUUID(),
      projectId,
      authorNodeId: this.nodeId,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
      type: 'TASK_PARENT_CHANGED',
      payload: { taskId, newParentId },
    };

    await this.repository.saveEvent(event);
    await this.transport.broadcast({ type: 'EVENT_BROADCAST', event });
    return event;
  }

  public async deleteTask(projectId: string, taskId: string): Promise<SyncEvent> {
    const event: SyncEvent = {
      id: crypto.randomUUID(),
      projectId,
      authorNodeId: this.nodeId,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
      type: 'TASK_DELETED',
      payload: { taskId },
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
