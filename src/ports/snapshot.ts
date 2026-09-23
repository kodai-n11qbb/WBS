import { ProjectState, TaskStatus, TaskPriority } from '../domain/types.js';

export interface RawSnapshotTask {
  id: string;
  projectId: string;
  parentId?: string | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  orderIndex: number;
  isCollapsed?: boolean;
  updatedAt: number;
  dueDate?: number | null;
  authorNodeId: string;
}

export interface RawSnapshotData {
  projectId: string;
  projectName?: string;
  updatedAt: number;
  totalTasks: number;
  tasks: RawSnapshotTask[];
}

export interface StateSnapshotExporterPort {
  saveSnapshot(state: ProjectState): Promise<void>;
  loadSnapshot(): Promise<RawSnapshotData | null>;
}
