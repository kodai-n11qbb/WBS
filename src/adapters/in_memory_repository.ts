import { EventRepositoryPort } from '../ports/repository.js';
import { SyncEvent } from '../domain/types.js';

export class InMemoryRepository implements EventRepositoryPort {
  private events: Map<string, SyncEvent> = new Map();

  public async saveEvent(event: SyncEvent): Promise<boolean> {
    if (this.events.has(event.id)) {
      return false;
    }
    this.events.set(event.id, event);
    return true;
  }

  public async saveEvents(events: SyncEvent[]): Promise<number> {
    let savedCount = 0;
    for (const event of events) {
      if (await this.saveEvent(event)) {
        savedCount++;
      }
    }
    return savedCount;
  }

  public async getAllEvents(): Promise<SyncEvent[]> {
    return Array.from(this.events.values());
  }

  public async getEventsSince(sinceTimestamp: number): Promise<SyncEvent[]> {
    return Array.from(this.events.values()).filter(
      (e) => e.timestamp > sinceTimestamp
    );
  }
}
