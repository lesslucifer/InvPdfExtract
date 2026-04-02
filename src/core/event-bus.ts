import { EventEmitter } from 'events';
import { AppEvents } from '../shared/types';

class TypedEventEmitter {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof AppEvents>(event: K, listener: (data: AppEvents[K]) => void): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof AppEvents>(event: K, listener: (data: AppEvents[K]) => void): void {
    this.emitter.off(event, listener);
  }

  emit<K extends keyof AppEvents>(event: K, data: AppEvents[K]): void {
    this.emitter.emit(event, data);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }
}

export const eventBus = new TypedEventEmitter();
