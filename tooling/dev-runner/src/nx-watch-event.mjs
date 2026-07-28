const payload = Buffer.from(
  JSON.stringify({
    project: process.env["NX_PROJECT_NAME"] ?? "",
    files: (process.env["NX_FILE_CHANGES"] ?? "").split(/\s+/).filter(Boolean),
  }),
).toString("base64url");

process.stdout.write(`@@VIBEFIELD_NX_CHANGE@@${payload}\n`);
