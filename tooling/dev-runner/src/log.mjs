const PREFIX = "[vibefield:dev]";

export const log = Object.freeze({
  info(message) {
    process.stdout.write(`${PREFIX} ${message}\n`);
  },
  warn(message) {
    process.stderr.write(`${PREFIX} warning: ${message}\n`);
  },
  error(message) {
    process.stderr.write(`${PREFIX} error: ${message}\n`);
  },
});
