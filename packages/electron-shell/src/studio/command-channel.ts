export type StudioHostCommand =
  | { type: "studio.open"; section?: "design" | "appearance" }
  | { type: "studio.focus" }
  | { type: "studio.close" }
  | { type: "studio.status" };

export interface StudioCommandHost {
  handleCommand(command: StudioHostCommand): Promise<Record<string, unknown>>;
}

/** Closed child-process IPC used only by the development Studio main entry. */
export function installStudioCommandChannel(host: StudioCommandHost): void {
  process.on("message", (raw) => {
    const request = parseStudioHostCommandRequest(raw);
    if (request === null) return;
    void host
      .handleCommand(request.command)
      .then((result) => respond(request.requestId, true, result))
      .catch(() => respond(request.requestId, false, { state: "rejected" }));
  });
}

export function parseStudioHostCommandRequest(
  raw: unknown,
): { requestId: string; command: StudioHostCommand } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const message = raw as Record<string, unknown>;
  if (
    message["version"] !== 1 ||
    message["type"] !== "vibefield.dev-command" ||
    typeof message["requestId"] !== "string" ||
    !/^runner-[1-9][0-9]{0,8}$/.test(message["requestId"])
  ) {
    return null;
  }
  const command = parseCommand(message["command"]);
  return command === null ? null : { requestId: message["requestId"], command };
}

function parseCommand(raw: unknown): StudioHostCommand | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const command = raw as Record<string, unknown>;
  const keys = Object.keys(command).sort();
  switch (command["type"]) {
    case "studio.open":
      if (command["section"] === undefined && exactKeys(keys, ["type"])) {
        return { type: "studio.open" };
      }
      if (
        exactKeys(keys, ["section", "type"]) &&
        (command["section"] === "design" || command["section"] === "appearance")
      ) {
        return { type: "studio.open", section: command["section"] };
      }
      return null;
    case "studio.focus":
    case "studio.close":
    case "studio.status":
      return exactKeys(keys, ["type"]) ? { type: command["type"] } : null;
    default:
      return null;
  }
}

function exactKeys(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function respond(requestId: string, ok: boolean, result: Record<string, unknown>): void {
  if (typeof process.send !== "function") return;
  process.send({
    version: 1,
    type: "vibefield.dev-command-result",
    requestId,
    ok,
    result,
  });
}
