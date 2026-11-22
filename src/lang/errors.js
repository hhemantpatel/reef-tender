// Every failure the player can cause is a ReefError: it knows the line it happened
// on so the editor can point at it, and its message is written for a person.

export class ReefError extends Error {
  constructor(message, line = 0, col = 0, kind = 'error') {
    super(message);
    this.name = 'ReefError';
    this.line = line;
    this.col = col;
    this.kind = kind; // 'syntax' | 'locked' | 'runtime' | 'error'
  }
}

export const syntaxError = (msg, line, col) => new ReefError(msg, line, col, 'syntax');
export const lockedError = (msg, line, col) => new ReefError(msg, line, col, 'locked');
export const runtimeError = (msg, line, col) => new ReefError(msg, line, col, 'runtime');
