export const isDebug = process.env.DEBUG === 'true';

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
  }
};
