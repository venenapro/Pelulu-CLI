/**
 * EventBus — lightweight pub/sub for decoupled communication
 */
import { EventEmitter } from 'events';

class Bus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  emit(event, ...args) {
    return super.emit(event, ...args);
  }

  on(event, fn) {
    return super.on(event, fn);
  }

  once(event, fn) {
    return super.once(event, fn);
  }

  off(event, fn) {
    return super.off(event, fn);
  }

  waitFor(event, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(event, handler);
        reject(new Error(`Timeout waiting for "${event}"`));
      }, timeoutMs);
      const handler = (...args) => {
        clearTimeout(timer);
        resolve(args);
      };
      this.once(event, handler);
    });
  }
}

export const bus = new Bus();
