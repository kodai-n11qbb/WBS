import { EventRepositoryPort } from '../ports/repository.js';
import { PeerTransportPort, PeerInfo, TransportMessage } from '../ports/transport.js';
import { StateSnapshotExporterPort } from '../ports/snapshot.js';
import { SyncEngine } from '../domain/sync_engine.js';
import { TaskValidatorPort, StructuredTaskValidator } from '../domain/task_validator.js';
import { ProjectState, SyncEvent, TaskStatus, TaskPriority } from '../domain/types.js';
import { crypto } from './crypto_util.js';

export interface CreateTaskInput {
  parentId?: string | null;
  title: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  orderIndex?: number;
  dueDate?: number | null;
}

export interface NodeServiceDependencies {
  nodeId: string;
  repository: EventRepositoryPort;
  transport: PeerTransportPort;
  syncEngine: SyncEngine;
  validator?: TaskValidatorPort;
  snapshotExporter?: StateSnapshotExporterPort;
}

export class NodeService {
  private nodeId: string;
  private repository: EventRepositoryPort;
  private transport: PeerTransportPort;
  private syncEngine: SyncEngine;
  private validator: TaskValidatorPort;
  private snapshotExporter?: StateSnapshotExporterPort;
  private sequenceCounter: number = 0;

  constructor(deps: NodeServiceDependencies) {
    this.nodeId = deps.nodeId;
    this.repository = deps.repository;
    this.transport = deps.transport;
    this.syncEngine = deps.syncEngine;
    this.validator = deps.validator || new StructuredTaskValidator();
    this.snapshotExporter = deps.snapshotExporter;

    this.setupTransportListeners();
  }

  private async exportSnapshot(projectId: string): Promise<void> {
    if (this.snapshotExporter) {
      try {
        const state = await this.getProjectState(projectId);
        await this.snapshotExporter.saveSnapshot(state);
      } catch (e) {
        console.error('[NodeService] Snapshot Export Error:', e);
      }
    }
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
    await this.exportSnapshot(projectId);
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
        priority: input.priority || 'MEDIUM',
        status: input.status || 'TODO',
        orderIndex: typeof input.orderIndex === 'number' ? input.orderIndex : Date.now(),
        dueDate: typeof input.dueDate === 'number' ? input.dueDate : null,
        isCollapsed: false,
      },
    };

    await this.repository.saveEvent(event);
    await this.transport.broadcast({ type: 'EVENT_BROADCAST', event });
    await this.exportSnapshot(projectId);
    return event;
  }

  public async updateTaskStatus(
    projectId: string,
    taskId: string,
    status: TaskStatus,
    newOrderIndex?: number
  ): Promise<SyncEvent> {
    const state = await this.getProjectState(projectId);
    const existingTask = state.tasks.get(taskId);
    const validation = this.validator.validateStatusChange(status, existingTask?.dueDate);
    if (!validation.valid) {
      throw new Error(`ステータス更新失敗: ${validation.errors.join(' / ')}`);
    }

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
    await this.exportSnapshot(projectId);
    return event;
  }

  public async updateTaskTitle(
    projectId: string,
    taskId: string,
    title: string
  ): Promise<SyncEvent> {
    if (!title || !title.trim()) {
      throw new Error('タスクタイトルは空にできません');
    }
    const event: SyncEvent = {
      id: crypto.randomUUID(),
      projectId,
      authorNodeId: this.nodeId,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
      type: 'TASK_TITLE_UPDATED',
      payload: { taskId, title: title.trim() },
    };

    await this.repository.saveEvent(event);
    await this.transport.broadcast({ type: 'EVENT_BROADCAST', event });
    await this.exportSnapshot(projectId);
    return event;
  }

  public async updateTaskDueDate(
    projectId: string,
    taskId: string,
    dueDate: number | null
  ): Promise<SyncEvent> {
    const event: SyncEvent = {
      id: crypto.randomUUID(),
      projectId,
      authorNodeId: this.nodeId,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
      type: 'TASK_DUE_DATE_UPDATED',
      payload: { taskId, dueDate },
    };

    await this.repository.saveEvent(event);
    await this.transport.broadcast({ type: 'EVENT_BROADCAST', event });
    await this.exportSnapshot(projectId);
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
    await this.exportSnapshot(projectId);
    return event;
  }

  public async changeTaskParent(
    projectId: string,
    taskId: string,
    newParentId: string | null
  ): Promise<SyncEvent> {
    const state = await this.getProjectState(projectId);
    const validation = this.validator.validateParentChange(taskId, newParentId, state.tasks);
    if (!validation.valid) {
      throw new Error(`親タスク変更失敗: ${validation.errors.join(' / ')}`);
    }

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
    await this.exportSnapshot(projectId);
    return event;
  }

  public async toggleTaskCollapse(
    projectId: string,
    taskId: string,
    isCollapsed?: boolean
  ): Promise<SyncEvent> {
    const event: SyncEvent = {
      id: crypto.randomUUID(),
      projectId,
      authorNodeId: this.nodeId,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
      type: 'TASK_COLLAPSE_TOGGLED',
      payload: { taskId, isCollapsed },
    };

    await this.repository.saveEvent(event);
    await this.transport.broadcast({ type: 'EVENT_BROADCAST', event });
    await this.exportSnapshot(projectId);
    return event;
  }

  public async deleteTask(projectId: string, taskId: string, reason?: string): Promise<SyncEvent> {
    const state = await this.getProjectState(projectId);
    const validation = this.validator.validateDeletion(taskId, state.tasks, reason);
    if (!validation.valid) {
      throw new Error(`タスク削除失敗: ${validation.errors.join(' / ')}`);
    }

    const toDelete = new Set<string>([taskId]);
    let added = true;
    while (added) {
      added = false;
      for (const [id, t] of state.tasks.entries()) {
        if (t.parentId && toDelete.has(t.parentId) && !toDelete.has(id)) {
          toDelete.add(id);
          added = true;
        }
      }
    }

    let lastEvent: SyncEvent | null = null;
    for (const id of toDelete) {
      const event: SyncEvent = {
        id: crypto.randomUUID(),
        projectId,
        authorNodeId: this.nodeId,
        timestamp: Date.now(),
        sequence: ++this.sequenceCounter,
        type: 'TASK_DELETED',
        payload: { taskId: id, reason: id === taskId ? reason : undefined },
      };

      await this.repository.saveEvent(event);
      await this.transport.broadcast({ type: 'EVENT_BROADCAST', event });
      lastEvent = event;
    }
    await this.exportSnapshot(projectId);
    return lastEvent!;
  }

  public async undoLastAction(projectId: string): Promise<SyncEvent | null> {
    const allEvents = await this.repository.getAllEvents();
    const myEvents = allEvents.filter(
      (e) => e.projectId === projectId && e.authorNodeId === this.nodeId && e.type !== 'UNDO_ACTION' && e.type !== 'PROJECT_CREATED'
    );

    if (myEvents.length === 0) {
      return null;
    }

    const lastEvent = myEvents[myEvents.length - 1];
    const undoEvent: SyncEvent = {
      id: crypto.randomUUID(),
      projectId,
      authorNodeId: this.nodeId,
      timestamp: Date.now(),
      sequence: ++this.sequenceCounter,
      type: 'UNDO_ACTION',
      payload: {
        revertedEventId: lastEvent.id,
        revertedEventType: lastEvent.type,
        revertedPayload: lastEvent.payload,
      },
    };

    await this.repository.saveEvent(undoEvent);
    await this.transport.broadcast({ type: 'EVENT_BROADCAST', event: undoEvent });
    await this.exportSnapshot(projectId);
    return undoEvent;
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
        await this.exportSnapshot(msg.event.projectId);
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
        if (msg.events.length > 0) {
          await this.exportSnapshot(msg.events[0].projectId);
        }
        break;
    }
  }
}
