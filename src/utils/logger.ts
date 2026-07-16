export const isDebug = process.env.DEBUG === 'true';

const timers = new Map<string, number>();

export const logger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  warn: (msg: string) => console.log(`[WARN] ${msg}`),
  error: (msg: string | Error) => {
    if (msg instanceof Error) {
      console.error(`[ERROR] ${msg.message}`);
      if (isDebug && msg.stack) console.error(msg.stack);
    } else {
      console.error(`[ERROR] ${msg}`);
    }
  },
  debug: (msg: string) => {
    if (isDebug) console.log(`[DEBUG] ${msg}`);
  },
  time: (label: string) => {
    timers.set(label, Date.now());
  },
  timeEnd: (label: string, message: string = label) => {
    const start = timers.get(label);
    if (start) {
      const ms = Date.now() - start;
      console.log(`[INFO] ${message} (${ms} ms)`);
      timers.delete(label);
    }
  }
};
