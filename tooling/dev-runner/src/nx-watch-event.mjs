// NX_FILE_CHANGES is whitespace-delimited by Nx itself, so a path containing
// whitespace cannot survive this split. Preflight forbids the class repo-wide
// (scripts/preflight.mjs, tracked-filename check) rather than guessing here.
const payload = Buffer.from(
  JSON.stringify({
    project: process.env["NX_PROJECT_NAME"] ?? "",
    files: (process.env["NX_FILE_CHANGES"] ?? "").split(/\s+/).filter(Boolean),
  }),
).toString("base64url");

process.stdout.write(`@@VIBEFIELD_NX_CHANGE@@${payload}\n`);
