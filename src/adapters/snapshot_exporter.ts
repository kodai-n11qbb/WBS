import fs from 'node:fs';
import path from 'node:path';
import { StateSnapshotExporterPort } from '../ports/snapshot.js';
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
}
