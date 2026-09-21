import fs from 'node:fs';
import path from 'node:path';
import { EventRepositoryPort } from '../ports/repository.js';
import { SyncEvent } from '../domain/types.js';

export class JsonlFileRepository implements EventRepositoryPort {
  private filePath: string;
  private events: Map<string, SyncEvent> = new Map();
  private initialized: boolean = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  public async init(): Promise<void> {
    if (this.initialized) return;

    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.filePath)) {
      const fileContent = fs.readFileSync(this.filePath, 'utf-8');
      const lines = fileContent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          try {
            const event: SyncEvent = JSON.parse(trimmed);
            if (event && event.id) {
              this.events.set(event.id, event);
            }
          } catch (e) {
            // Ignore malformed lines
          }
        }
      }
    } else {
      fs.writeFileSync(this.filePath, '', 'utf-8');
    }

    this.initialized = true;
  }

  public async saveEvent(event: SyncEvent): Promise<boolean> {
    await this.init();
    if (this.events.has(event.id)) {
      return false;
    }

    this.events.set(event.id, event);
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(this.filePath, line, 'utf-8');
    return true;
  }

  public async saveEvents(events: SyncEvent[]): Promise<number> {
    await this.init();
    let savedCount = 0;
    for (const event of events) {
      if (await this.saveEvent(event)) {
        savedCount++;
      }
    }
    return savedCount;
  }

  public async getAllEvents(): Promise<SyncEvent[]> {
    await this.init();
    return Array.from(this.events.values());
  }

  public async getEventsSince(sinceTimestamp: number): Promise<SyncEvent[]> {
    await this.init();
    return Array.from(this.events.values()).filter((e) => e.timestamp > sinceTimestamp);
  }
}
