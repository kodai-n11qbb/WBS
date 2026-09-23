import fs from 'node:fs';
import path from 'node:path';
import { StateSnapshotExporterPort, RawSnapshotData } from '../ports/snapshot.js';
import { ProjectState } from '../domain/types.js';

export class JsonStateSnapshotExporter implements StateSnapshotExporterPort {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  public async saveSnapshot(state: ProjectState): Promise<void> {
    if (!state) return;

    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tasksArray = Array.from(state.tasks.values()).map((t) => ({
      id: t.id,
      projectId: t.projectId,
      parentId: t.parentId || null,
      title: t.title,
      status: t.status,
      priority: t.priority,
      orderIndex: t.orderIndex,
      isCollapsed: !!t.isCollapsed,
      updatedAt: t.updatedAt,
      dueDate: t.dueDate || null,
      authorNodeId: t.authorNodeId,
    }));

    const snapshotData = {
      projectId: state.project ? state.project.id : 'default-project',
      projectName: state.project ? state.project.name : 'Default Project',
      updatedAt: Date.now(),
      totalTasks: tasksArray.length,
      tasks: tasksArray,
    };

    const jsonContent = JSON.stringify(snapshotData, null, 2);
    fs.writeFileSync(this.filePath, jsonContent, 'utf-8');
  }

  public async loadSnapshot(): Promise<RawSnapshotData | null> {
    if (!fs.existsSync(this.filePath)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as RawSnapshotData;
      if (parsed && Array.isArray(parsed.tasks)) {
        return parsed;
      }
      return null;
    } catch (err) {
      console.warn(`[SnapshotExporter] Failed to load snapshot at ${this.filePath}:`, err);
      return null;
    }
  }
}
