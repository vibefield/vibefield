import { randomBytes } from "node:crypto";
import {
  ARTIFACT_PREVIEW_LIMITS,
  type CallerContext,
  SHELL_PROVIDER_METHODS,
  type ShellClientProviderMethod,
  ShellDialogPickFolderParams,
  ShellDialogPickFolderResult,
  type ShellInternalProviderMethod,
  ShellOpenExternalParams,
  ShellOpenExternalResult,
  type ShellProviderCallParams,
  type ShellProviderMethod,
  ShellProviderRegisterParams,
  type ShellProviderRegisterResult,
  ShellProviderResolveParams,
  type ShellProviderResolveResult,
  ShellWebContentsCaptureArtifactPreviewParams,
  ShellWebContentsCaptureArtifactPreviewResult,
} from "@vibefield/contracts";
import { RpcCallError } from "./native-link";

const OPEN_EXTERNAL_DEADLINE_MS = 5_000;

export interface ShellProviderTransport {
  /** Connection-owned identity. It is never caller data. */
  readonly identity: object;
  notify(method: "shell.provider.call" | "shell.provider.cancel", params: unknown): boolean;
}

interface MethodContract {
  input: Schema;
  output: Schema;
  deadlineMs: number | null;
}

interface Schema {
  safeParse(
    value: unknown,
  ): { success: true; data: unknown } | { success: false; error: { issues: readonly unknown[] } };
}

const METHOD_CONTRACTS: Record<ShellProviderMethod, MethodContract> = {
  "shell.dialog.pickFolder": {
    input: ShellDialogPickFolderParams,
    output: ShellDialogPickFolderResult,
    // A visible native picker lives for the caller/window lifetime, not a
    // theater timeout. deadlineAt remains a bounded wire integer.
    deadlineMs: null,
  },
  "shell.openExternal": {
    input: ShellOpenExternalParams,
    output: ShellOpenExternalResult,
    deadlineMs: OPEN_EXTERNAL_DEADLINE_MS,
  },
  "shell.webcontents.captureArtifactPreview": {
    input: ShellWebContentsCaptureArtifactPreviewParams,
    output: ShellWebContentsCaptureArtifactPreviewResult,
    deadlineMs: ARTIFACT_PREVIEW_LIMITS.DEADLINE_MS,
  },
};

interface Provider {
  transport: ShellProviderTransport;
  methods: ReadonlySet<ShellProviderMethod>;
}

interface PendingCall {
  provider: Provider;
  method: ShellProviderMethod;
  output: Schema;
  resolve(value: unknown): void;
  reject(error: RpcCallError): void;
  timer: ReturnType<typeof setTimeout> | null;
  callerSignal: AbortSignal | undefined;
  onCallerAbort: (() => void) | null;
}

function assertShellPrincipal(ctx: CallerContext): void {
  if (ctx.transport !== "ws-loopback" || ctx.principal.kind !== "shell-main") {
    throw new RpcCallError(
      "FORBIDDEN_SCOPE",
      "shell provider lifecycle is available only to authenticated Electron main",
      false,
    );
  }
}

function safeCaller(ctx: CallerContext): ShellProviderCallParams["caller"] {
  return {
    kind: ctx.principal.kind,
    ...(ctx.principal.kind === "plugin" ? { pluginId: ctx.principal.id } : {}),
    ...(ctx.clientKind !== undefined ? { clientKind: ctx.clientKind } : {}),
  };
}

/** One static provider on the authenticated shell connection. The broker owns
 * liveness, deadlines, caller cancellation, and output validation; Electron
 * main owns only the bounded OS operation. */
export class ShellProviderBroker {
  private provider: Provider | null = null;
  private readonly pending = new Map<string, PendingCall>();

  /** In-process capability fact only; this never exposes provider identity or
   * grants a caller access to the internal capture method. */
  provides(method: ShellProviderMethod): boolean {
    return this.provider?.methods.has(method) === true;
  }

  register(
    ctx: CallerContext,
    transport: ShellProviderTransport,
    raw: unknown,
  ): ShellProviderRegisterResult {
    assertShellPrincipal(ctx);
    const parsed = ShellProviderRegisterParams.safeParse(raw);
    if (!parsed.success) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "expected the exact enabled shell provider method set",
        false,
      );
    }
    const proposed = new Set(parsed.data.methods);
    if (
      proposed.size !== SHELL_PROVIDER_METHODS.length ||
      !SHELL_PROVIDER_METHODS.every((method) => proposed.has(method))
    ) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "shell provider registration must match the enabled static method set",
        false,
      );
    }
    const current = this.provider;
    if (current !== null && current.transport.identity !== transport.identity) {
      throw new RpcCallError("CONFLICT", "a shell provider is already connected", true);
    }
    // Registration is idempotent on one live transport. Keeping the same
    // Provider object is load-bearing: pending calls retain it for atomic
    // provider-loss rejection.
    if (current !== null) return { registered: [...SHELL_PROVIDER_METHODS] };
    this.provider = { transport, methods: proposed };
    return { registered: [...SHELL_PROVIDER_METHODS] };
  }

  resolve(
    ctx: CallerContext,
    transport: ShellProviderTransport,
    raw: unknown,
  ): ShellProviderResolveResult {
    assertShellPrincipal(ctx);
    const parsed = ShellProviderResolveParams.safeParse(raw);
    if (!parsed.success) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "expected a bounded shell provider outcome",
        false,
      );
    }
    const call = this.pending.get(parsed.data.callId);
    if (call === undefined || call.provider.transport.identity !== transport.identity) {
      return { accepted: false };
    }
    this.detach(parsed.data.callId, call);
    if (parsed.data.outcome.error !== undefined) {
      const error = parsed.data.outcome.error;
      call.reject(new RpcCallError(error.kind, error.message, error.retryable));
      return { accepted: true };
    }
    const output = call.output.safeParse(parsed.data.outcome.result);
    if (!output.success) {
      call.reject(
        new RpcCallError(
          "INTERNAL",
          `shell provider returned an invalid result for ${call.method}`,
          false,
        ),
      );
      return { accepted: true };
    }
    call.resolve(output.data);
    return { accepted: true };
  }

  async call(
    ctx: CallerContext,
    method: ShellClientProviderMethod,
    raw: unknown,
  ): Promise<unknown> {
    if (ctx.transport !== "ws-loopback") {
      throw new RpcCallError(
        "FORBIDDEN_SCOPE",
        "desktop shell operations are available only to local callers",
        false,
      );
    }
    return await this.dispatch(ctx, method, raw);
  }

  /** AH-4's capture door is deliberately not a ProductAPI method. Only
   * fieldd's ArtifactService adapter can enter here, and the provider sees an
   * explicit fieldd caller rather than inheriting a renderer's authority. */
  callInternal(method: ShellInternalProviderMethod, raw: unknown): Promise<unknown> {
    return this.dispatch(
      {
        principal: { kind: "local-token", tokenId: "artifact-service", scopes: [] },
        transport: "inproc-port",
        receivedAt: Date.now(),
        clientKind: "fieldd",
      },
      method,
      raw,
    );
  }

  private async dispatch(
    ctx: CallerContext,
    method: ShellProviderMethod,
    raw: unknown,
  ): Promise<unknown> {
    const contract = METHOD_CONTRACTS[method];
    const input = contract.input.safeParse(raw);
    if (!input.success) {
      throw new RpcCallError("PRECONDITION_FAILED", `malformed ${method} params`, false);
    }
    const provider = this.provider;
    if (provider === null || !provider.methods.has(method)) {
      throw new RpcCallError("UNAVAILABLE", "desktop shell provider is unavailable", true, {
        service: "shell",
        state: "unavailable",
      });
    }
    if (ctx.signal?.aborted) {
      throw new RpcCallError("UNAVAILABLE", "caller disconnected before shell dispatch", true, {
        service: "shell",
        state: "caller-gone",
      });
    }
    const callId = `shell-${randomBytes(18).toString("base64url")}`;
    const deadlineAt =
      contract.deadlineMs === null
        ? Number.MAX_SAFE_INTEGER
        : Math.min(Number.MAX_SAFE_INTEGER, Date.now() + contract.deadlineMs);

    return await new Promise<unknown>((resolve, reject) => {
      const call: PendingCall = {
        provider,
        method,
        output: contract.output,
        resolve,
        reject,
        timer: null,
        callerSignal: ctx.signal,
        onCallerAbort: null,
      };
      const cancel = (error: RpcCallError) => {
        if (this.pending.get(callId) !== call) return;
        this.detach(callId, call);
        if (!provider.transport.notify("shell.provider.cancel", { callId })) {
          this.withdraw(provider.transport);
        }
        reject(error);
      };
      if (contract.deadlineMs !== null) {
        call.timer = setTimeout(
          () =>
            cancel(
              new RpcCallError("TIMEOUT", `${method} timed out`, true, {
                service: "shell",
                state: "timeout",
              }),
            ),
          contract.deadlineMs,
        );
      }
      if (ctx.signal !== undefined) {
        call.onCallerAbort = () =>
          cancel(
            new RpcCallError("UNAVAILABLE", "shell caller disconnected", true, {
              service: "shell",
              state: "caller-gone",
            }),
          );
        ctx.signal.addEventListener("abort", call.onCallerAbort, { once: true });
      }
      this.pending.set(callId, call);
      const notification: ShellProviderCallParams = {
        callId,
        method,
        params: input.data,
        caller: safeCaller(ctx),
        deadlineAt,
      };
      if (!provider.transport.notify("shell.provider.call", notification)) {
        this.withdraw(provider.transport);
      }
    });
  }

  withdraw(transport: ShellProviderTransport): void {
    if (this.provider?.transport.identity !== transport.identity) return;
    const provider = this.provider;
    this.provider = null;
    for (const [callId, call] of [...this.pending]) {
      if (call.provider !== provider) continue;
      this.detach(callId, call);
      call.reject(
        new RpcCallError("UNAVAILABLE", "desktop shell provider disconnected", true, {
          service: "shell",
          state: "provider-lost",
        }),
      );
    }
  }

  dispose(): void {
    const provider = this.provider;
    if (provider !== null) this.withdraw(provider.transport);
  }

  private detach(callId: string, call: PendingCall): void {
    if (this.pending.get(callId) !== call) return;
    this.pending.delete(callId);
    if (call.timer !== null) clearTimeout(call.timer);
    if (call.callerSignal !== undefined && call.onCallerAbort !== null) {
      call.callerSignal.removeEventListener("abort", call.onCallerAbort);
    }
  }
}
