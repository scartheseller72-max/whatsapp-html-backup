'use strict';

/**
 * Minimal single-line terminal progress bar with ETA. No dependencies.
 * Safe when stdout is not a TTY (falls back to occasional line prints).
 */

class Progress {
  constructor(total, label) {
    this.total = Math.max(total, 1);
    this.label = label || '';
    this.current = 0;
    this.start = Date.now();
    this.tty = !!(process.stdout && process.stdout.isTTY);
    this.lastPrint = 0;
  }

  tick(n = 1) {
    this.current += n;
    this.render();
  }

  set(value) {
    this.current = value;
    this.render();
  }

  render(force = false) {
    const now = Date.now();
    if (!force && now - this.lastPrint < 120) return;
    this.lastPrint = now;
    const ratio = Math.min(this.current / this.total, 1);
    const pctNum = Math.round(ratio * 100);
    const elapsed = (now - this.start) / 1000;
    const rate = this.current / Math.max(elapsed, 0.001);
    const remain = rate > 0 ? Math.max((this.total - this.current) / rate, 0) : 0;
    const eta = remain >= 1 ? `${Math.ceil(remain)}s` : '<1s';

    if (this.tty) {
      const width = 24;
      const filled = Math.round(ratio * width);
      const bar = `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
      const line = `  ${this.label} [${bar}] ${pctNum}% (${this.current}/${this.total}) ETA ${eta}`;
      process.stdout.write(`\r${line.slice(0, 100).padEnd(100)}`);
    } else if (pctNum % 25 === 0) {
      process.stdout.write(`  ${this.label} ${pctNum}% (${this.current}/${this.total})\n`);
    }
  }

  done() {
    this.current = this.total;
    this.render(true);
    if (this.tty) process.stdout.write('\n');
  }
}

module.exports = { Progress };
