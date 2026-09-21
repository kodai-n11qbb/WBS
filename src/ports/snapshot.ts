import { ProjectState } from '../domain/types.js';

export interface StateSnapshotExporterPort {
  saveSnapshot(state: ProjectState): Promise<void>;
}
