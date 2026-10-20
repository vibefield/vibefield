import { createServer } from "vite";

export function rendererDevelopmentDefines({ forceOnboarding = false } = {}) {
  return {
    __VIBEFIELD_FORCE_ONBOARDING__: JSON.stringify(forceOnboarding),
  };
}

export async function startRendererServer(paths, options = {}) {
  const server = await withoutProcessExits(() =>
    createServer({
      configFile: paths.viteConfig,
      mode: "development",
      clearScreen: false,
      define: rendererDevelopmentDefines(options),
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false,
      },
    }),
  );
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") {
    await server.close();
    throw new Error("Vite did not expose its bound development port");
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => server.close(),
  };
}

/**
 * Run `create`, then take back every process-level exit it installed. Vite's server mode takes the
 * process it runs in: a SIGTERM listener that closes the server and then calls `process.exit()` with
 * 128 + the signal, and the same on stdin's end (vite 8 `setupSIGTERMListener`). Here the runner owns
 * the process, and its own teardown closes Vite only after it has stopped Electron and the daemon
 * pair. Vite's listener raced that teardown and won: a SIGTERM to the runner exited 143 and left
 * Electron, fieldd, the floor and its cells running (2026-10-17, 2026-10-20). Only the listeners
 * `create` added are removed; the runner's own stay.
 */
export async function withoutProcessExits(create, host = process) {
  const sigterm = new Set(host.listeners("SIGTERM"));
  const stdinEnd = new Set(host.stdin.listeners("end"));
  try {
    return await create();
  } finally {
    for (const listener of host.listeners("SIGTERM")) {
      if (!sigterm.has(listener)) host.off("SIGTERM", listener);
    }
    for (const listener of host.stdin.listeners("end")) {
      if (!stdinEnd.has(listener)) host.stdin.off("end", listener);
    }
  }
}
