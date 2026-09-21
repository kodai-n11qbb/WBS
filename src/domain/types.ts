export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';

export interface Task {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  assignedNodeId?: string;
  updatedAt: number;
  authorNodeId: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
}

export type EventType = 'PROJECT_CREATED' | 'TASK_CREATED' | 'TASK_STATUS_UPDATED' | 'TASK_DELETED';

export interface SyncEvent {
  id: string;
  projectId: string;
  authorNodeId: string;
  timestamp: number;
  sequence: number;
  type: EventType;
  payload: any;
}

export interface ProjectState {
  project?: Project;
  tasks: Map<string, Task>;
}
