/**
 * Spinner — progress indicator for long operations
 */
import { COLORS } from './logger.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
  constructor(text = 'Working...') {
    this.text = text;
    this.i = 0;
    this.timer = null;
    this.stream = process.stderr;
  }

  start(text) {
    if (text) this.text = text;
    this.i = 0;
    this.timer = setInterval(() => {
      this.stream.write(`\r${COLORS.cyan}${FRAMES[this.i % FRAMES.length]}${COLORS.reset} ${this.text}`);
      this.i++;
    }, 80);
    return this;
  }

  update(text) {
    this.text = text;
    return this;
  }

  stop(finalText) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stream.write(`\r${' '.repeat(this.text.length + 4)}\r`);
    if (finalText) console.log(finalText);
    return this;
  }

  success(text) {
    this.stop(`${COLORS.green}[OK] ${text}${COLORS.reset}`);
  }

  fail(text) {
    this.stop(`${COLORS.red}[ERR] ${text}${COLORS.reset}`);
  }
}

export async function withSpinner(text, fn) {
  const spinner = new Spinner(text).start();
  try {
    const result = await fn(spinner);
    spinner.success(text);
    return result;
  } catch (e) {
    spinner.fail(`${text}: ${e.message}`);
    throw e;
  }
}
