export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type TaskPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Task {
  id: string;
  projectId: string;
  parentId?: string | null;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  orderIndex: number;
  isCollapsed?: boolean;
  assignedNodeId?: string;
  updatedAt: number;
  authorNodeId: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
}

export type EventType =
  | 'PROJECT_CREATED'
  | 'TASK_CREATED'
  | 'TASK_STATUS_UPDATED'
  | 'TASK_REORDERED'
  | 'TASK_PARENT_CHANGED'
  | 'TASK_COLLAPSE_TOGGLED'
  | 'TASK_DELETED';

export interface SyncEvent {
  id: string;
  projectId: string;
  authorNodeId: string;
  timestamp: number;
  sequence: number;
  type: EventType;
  previousHash?: string;
  hash?: string;
  payload: any;
}

export interface ProjectState {
  project?: Project;
  tasks: Map<string, Task>;
}
