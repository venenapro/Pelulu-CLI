/**
 * Thinking — AI processing indicator
 * Shows thinking state like Claude Code's "thinking..." display
 */
import { COLORS } from './logger.js';
import { bus } from './event-bus.js';

const THINK_STATES = {
  idle: { icon: '-', text: 'Idle' },
  thinking: { icon: '..', text: 'Thinking...' },
  tool_call: { icon: '>>', text: 'Using tool...' },
  reading: { icon: '..', text: 'Reading file...' },
  writing: { icon: '..', text: 'Writing...' },
  searching: { icon: '..', text: 'Searching...' },
  building: { icon: '..', text: 'Building...' },
  testing: { icon: '..', text: 'Testing...' },
};

export class Thinking {
  constructor() {
    this.state = 'idle';
    this.timer = null;
  }

  set(state) {
    this.state = state;
    const info = THINK_STATES[state] || THINK_STATES.idle;
    bus.emit('thinking', { state, ...info });
  }

  get() {
    return THINK_STATES[this.state] || THINK_STATES.idle;
  }

  format() {
    const info = this.get();
    return `${COLORS.dim}${info.icon} ${info.text}${COLORS.reset}`;
  }
}
