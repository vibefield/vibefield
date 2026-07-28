import { createServer } from "vite";

export async function startRendererServer(paths) {
  const server = await createServer({
    configFile: paths.viteConfig,
    mode: "development",
    clearScreen: false,
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
    },
  });
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
