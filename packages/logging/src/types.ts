import type { LogStream } from "@vibefield/contracts";
import type {
  LoggingHealthV1,
  LogLevelNameV1,
  LogRecordV1,
  LogRoleV1,
  LogServiceV1,
  LogTruncationV1,
  PluginLogProvenanceV1,
} from "@vibefield/contracts/logging";

export type LogFields = Readonly<Record<string, unknown>>;

export interface LoggerBindings {
  component?: string;
  traceId?: string;
  spanId?: string;
  operationId?: string;
  requestId?: string;
  sessionId?: string;
  docId?: string;
  deviceId?: string;
  windowId?: string;
}

/** Event-first, implementation-neutral first-party logging API. Pino and
 * destination details stay private to this package. */
export interface Logger {
  child(bindings: LoggerBindings): Logger;
  trace(event: string, message: string, attrs?: LogFields): void;
  debug(event: string, message: string, attrs?: LogFields): void;
  info(event: string, message: string, attrs?: LogFields): void;
  warn(event: string, message: string, attrs?: LogFields): void;
  error(event: string, message: string, error?: unknown, attrs?: LogFields): void;
  fatal(event: string, message: string, error?: unknown, attrs?: LogFields): void;
  isLevelEnabled(level: LogLevelNameV1): boolean;
}

export interface LogRetentionPolicy {
  maxSegmentBytes: number;
  maxClosedSegments: number;
  maxAgeMs: number;
  categoryCapBytes: number;
}

export interface LogBufferLimits {
  queueRecords: number;
  queueBytes: number;
  reservedRecords: number;
  reservedBytes: number;
  ringRecords: number;
  ringBytes: number;
  maxRecordBytes: number;
}

export interface LogSanitizerAliases {
  home?: string;
  temp?: string;
  logs?: string;
  data?: string;
}

/** Fault seams are intentionally narrow and test-only. Hooks throw an error
 * with a Node-style `code` to exercise failure policy without depending on the
 * host filesystem or current uid. */
export interface NodeLoggingTestHooks {
  beforeOpen?: (path: string) => void | Promise<void>;
  beforeWrite?: (path: string, bytes: number) => void | Promise<void>;
  beforeRename?: (from: string, to: string) => void | Promise<void>;
  beforeFlush?: (path: string) => void | Promise<void>;
  beforeClose?: (path: string) => void | Promise<void>;
  beforeRemove?: (path: string) => void | Promise<void>;
}

export interface CreateNodeLoggingOptions {
  logRoot: string;
  stream: LogStream;
  service: LogServiceV1;
  role: LogRoleV1;
  bootId: string;
  instanceId: string;
  component?: string;
  level?: LogLevelNameV1;
  pid?: number;
  now?: () => number;
  aliases?: LogSanitizerAliases;
  retention?: Partial<LogRetentionPolicy>;
  buffers?: Partial<LogBufferLimits>;
  emergency?: (message: string) => void;
  testHooks?: NodeLoggingTestHooks;
}

/** Trusted-host input after an Electron/child boundary has validated its wire
 * envelope. The sink still sanitizes values and owns every process identity,
 * sequence, service, role, boot, and instance field. */
export interface TrustedLogIngress {
  time: number;
  observedTime?: number;
  level: LogLevelNameV1;
  event: string;
  message: string;
  component: string;
  error?: unknown;
  attrs?: LogFields;
  bindings?: Omit<LoggerBindings, "component" | "windowId">;
  windowId?: string;
  pid?: number;
  truncation?: LogTruncationV1;
  /** Host-resolved provenance. Plugin streams require this field; system
   * streams reject it, preserving the physical category boundary. */
  plugin?: PluginLogProvenanceV1;
}

export interface RecentLogSnapshot {
  records: LogRecordV1[];
  oldestCursor: number;
  newestCursor: number;
  droppedBefore: number;
}

export interface NodeLogging {
  readonly logger: Logger;
  readonly filePath: string;
  ingest(record: TrustedLogIngress): void;
  health(): LoggingHealthV1;
  recent(limit?: number): RecentLogSnapshot;
  setLevel(level: LogLevelNameV1): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}
