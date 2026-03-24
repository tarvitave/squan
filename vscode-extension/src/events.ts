import { EventEmitter } from 'events'
import type { SquansqEvent } from './types'

class SquansqEventBus extends EventEmitter {
  emit(event: 'squansq', data: SquansqEvent): boolean
  emit(event: string | symbol, ...args: any[]): boolean
  emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args)
  }

  on(event: 'squansq', listener: (data: SquansqEvent) => void): this
  on(event: string | symbol, listener: (...args: any[]) => void): this
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener)
  }

  off(event: 'squansq', listener: (data: SquansqEvent) => void): this
  off(event: string | symbol, listener: (...args: any[]) => void): this
  off(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.off(event, listener)
  }
}

export const eventBus = new SquansqEventBus()

export function broadcastEvent(event: SquansqEvent): void {
  eventBus.emit('squansq', event)
}
