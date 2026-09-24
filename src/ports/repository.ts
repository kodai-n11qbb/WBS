import { SyncEvent } from '../domain/types.js';

export interface EventRepositoryPort {
  /**
   * Save a single event locally. Returns true if saved, false if duplicate.
   */
  saveEvent(event: SyncEvent): Promise<boolean>;

  /**
   * Bulk save events (e.g. from P2P sync).
   */
  saveEvents(events: SyncEvent[]): Promise<number>;

  /**
   * Retrieve all events stored locally.
   */
  getAllEvents(): Promise<SyncEvent[]>;

  /**
   * Get events with timestamp > sinceTimestamp for delta syncing.
   */
  getEventsSince(sinceTimestamp: number): Promise<SyncEvent[]>;

  /**
   * Reload events from disk in case of external file modification.
   * Returns count of newly appended / updated events.
   */
  reloadFromDisk?(): Promise<number>;
}
