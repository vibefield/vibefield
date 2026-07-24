import { LOG_STREAMS } from "@vibefield/contracts";
import type {
  CrashArtifactListV1,
  DiagnosticLeaseCreateV1,
  DiagnosticLeaseListV1,
  DiagnosticLeaseV1,
  DiagnosticLogDeltaV1,
  DiagnosticLogQueryV1,
  DiagnosticLogSnapshotV1,
  SupportBundlePreviewV1,
} from "@vibefield/contracts/diagnostics";
import type { LogLevelNameV1, LogRecordV1, LogStreamV1 } from "@vibefield/contracts/logging";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getHost } from "../host";

const ALL_SOURCES: readonly LogStreamV1[] = [
  LOG_STREAMS.SYSTEM_DESKTOP,
  LOG_STREAMS.SYSTEM_RENDERER,
  LOG_STREAMS.SYSTEM_UTILITY,
  LOG_STREAMS.SYSTEM_FIELDD,
  LOG_STREAMS.SYSTEM_FIELD_NATIVE,
  LOG_STREAMS.PLUGINS_RENDERER,
  LOG_STREAMS.PLUGINS_SERVICE,
  LOG_STREAMS.PLUGINS_UTILITY,
];
const LOCAL_SOURCES = new Set<LogStreamV1>([
  LOG_STREAMS.SYSTEM_DESKTOP,
  LOG_STREAMS.SYSTEM_RENDERER,
  LOG_STREAMS.SYSTEM_UTILITY,
  LOG_STREAMS.PLUGINS_RENDERER,
]);
const SYSTEM_SOURCES: readonly LogStreamV1[] = [
  LOG_STREAMS.SYSTEM_DESKTOP,
  LOG_STREAMS.SYSTEM_RENDERER,
  LOG_STREAMS.SYSTEM_UTILITY,
  LOG_STREAMS.SYSTEM_FIELDD,
  LOG_STREAMS.SYSTEM_FIELD_NATIVE,
];
const LEVELS: readonly LogLevelNameV1[] = ["trace", "debug", "info", "warn", "error", "fatal"];
const LEVEL_NUMBER: Record<LogLevelNameV1, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};
const MAX_VIEW_RECORDS = 1_000;

const labelCls = "text-neutral-400 dark:text-neutral-500";
const inputCls =
  "min-w-0 rounded border border-neutral-200 bg-neutral-50 px-1.5 py-1 text-neutral-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200";
const buttonCls =
  "rounded bg-neutral-100 px-2 py-1 text-neutral-600 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700";

interface FeedState {
  snapshot: DiagnosticLogSnapshotV1 | null;
  error: string | null;
}

interface LeaseRow {
  origin: "electron" | "fieldd";
  lease: DiagnosticLeaseV1;
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 240);
}

function isSnapshot(raw: unknown): raw is DiagnosticLogSnapshotV1 {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "v" in raw &&
    raw.v === 1 &&
    "records" in raw &&
    Array.isArray(raw.records) &&
    "producers" in raw &&
    Array.isArray(raw.producers) &&
    "nextCursor" in raw &&
    typeof raw.nextCursor === "string"
  );
}

function isDelta(raw: unknown): raw is DiagnosticLogDeltaV1 {
  return (
    typeof raw === "object" &&
    raw !== null &&
    "v" in raw &&
    raw.v === 1 &&
    "records" in raw &&
    Array.isArray(raw.records) &&
    "cursor" in raw &&
    typeof raw.cursor === "string" &&
    "droppedSincePrevious" in raw &&
    typeof raw.droppedSincePrevious === "number"
  );
}

function recordKey(record: LogRecordV1): string {
  return `${record.service}\0${record.role}\0${record.bootId}\0${record.instanceId}\0${record.seq}`;
}

function mergeRecords(...groups: ReadonlyArray<readonly LogRecordV1[]>): LogRecordV1[] {
  const records = new Map<string, LogRecordV1>();
  for (const group of groups) {
    for (const record of group) records.set(recordKey(record), record);
  }
  const sorted = [...records.values()].sort(
    (left, right) =>
      left.time - right.time ||
      (left.observedTime ?? left.time) - (right.observedTime ?? right.time) ||
      left.bootId.localeCompare(right.bootId) ||
      left.seq - right.seq,
  );
  return sorted.length <= MAX_VIEW_RECORDS
    ? sorted
    : sorted.slice(sorted.length - MAX_VIEW_RECORDS);
}

function applyDelta(
  snapshot: DiagnosticLogSnapshotV1 | null,
  delta: DiagnosticLogDeltaV1,
): DiagnosticLogSnapshotV1 | null {
  if (snapshot === null) return null;
  return {
    ...snapshot,
    records: mergeRecords(snapshot.records, delta.records),
    nextCursor: delta.cursor,
    droppedBefore: Math.min(
      Number.MAX_SAFE_INTEGER,
      snapshot.droppedBefore + delta.droppedSincePrevious,
    ),
  };
}

function sourceOf(record: LogRecordV1): LogStreamV1 {
  if (record.plugin?.entry === "renderer") return LOG_STREAMS.PLUGINS_RENDERER;
  if (record.plugin?.entry === "service") return LOG_STREAMS.PLUGINS_SERVICE;
  if (record.plugin?.entry === "utility") return LOG_STREAMS.PLUGINS_UTILITY;
  if (record.service === "desktop") return LOG_STREAMS.SYSTEM_DESKTOP;
  if (record.service === "renderer") return LOG_STREAMS.SYSTEM_RENDERER;
  if (record.service === "utility") return LOG_STREAMS.SYSTEM_UTILITY;
  if (record.service === "fieldd") return LOG_STREAMS.SYSTEM_FIELDD;
  return LOG_STREAMS.SYSTEM_FIELD_NATIVE;
}

function timeRangeMs(value: string): number | null {
  if (value === "15m") return 15 * 60 * 1_000;
  if (value === "1h") return 60 * 60 * 1_000;
  if (value === "24h") return 24 * 60 * 60 * 1_000;
  return null;
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1024 * 1_024) return `${(value / 1_024).toFixed(1)} KiB`;
  return `${(value / (1_024 * 1_024)).toFixed(1)} MiB`;
}

function remaining(expiresAt: number): string {
  if (expiresAt === Number.MAX_SAFE_INTEGER) return "until restart";
  const milliseconds = Math.max(0, expiresAt - Date.now());
  if (milliseconds < 60_000) return `${Math.ceil(milliseconds / 1_000)}s`;
  return `${Math.ceil(milliseconds / 60_000)}m`;
}

function transportTruncated(snapshot: DiagnosticLogSnapshotV1 | null): number {
  const value = snapshot?.["transportTruncatedRecords"];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function leaseList(raw: unknown): DiagnosticLeaseListV1 | null {
  return typeof raw === "object" &&
    raw !== null &&
    "v" in raw &&
    raw.v === 1 &&
    "leases" in raw &&
    Array.isArray(raw.leases)
    ? (raw as DiagnosticLeaseListV1)
    : null;
}

export function DiagnosticsSection(): ReactElement {
  const client = useFielddClient();
  const host = getHost().diagnostics;
  const [openFeed, setOpenFeed] = useState(true);
  const [paused, setPaused] = useState(false);
  const [follow, setFollow] = useState(true);
  const [source, setSource] = useState<LogStreamV1 | "all">("all");
  const [range, setRange] = useState("1h");
  const [minLevel, setMinLevel] = useState<LogLevelNameV1>("info");
  const [text, setText] = useState("");
  const [component, setComponent] = useState("");
  const [event, setEvent] = useState("");
  const [boot, setBoot] = useState("");
  const [pluginId, setPluginId] = useState("");
  const [traceId, setTraceId] = useState("");
  const [operationId, setOperationId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [docId, setDocId] = useState("");
  const [localFeed, setLocalFeed] = useState<FeedState>({
    snapshot: null,
    error: null,
  });
  const [remoteFeed, setRemoteFeed] = useState<FeedState>({
    snapshot: null,
    error: null,
  });
  const [leases, setLeases] = useState<LeaseRow[]>([]);
  const [leaseError, setLeaseError] = useState<string | null>(null);
  const [leaseTarget, setLeaseTarget] = useState<
    "desktop" | "renderer" | "utility" | "fieldd" | "plugin"
  >("fieldd");
  const [leaseComponent, setLeaseComponent] = useState("");
  const [leasePlugin, setLeasePlugin] = useState("");
  const [leasePluginEntry, setLeasePluginEntry] = useState<"both" | "renderer" | "service">("both");
  const [leaseLevel, setLeaseLevel] = useState<"trace" | "debug">("debug");
  const [leaseDuration, setLeaseDuration] = useState<"15m" | "1h" | "until-restart">("15m");
  const [leaseBusy, setLeaseBusy] = useState(false);
  const [crashes, setCrashes] = useState<CrashArtifactListV1 | null>(null);
  const [selectedCrashes, setSelectedCrashes] = useState<Set<string>>(new Set());
  const [supportPreview, setSupportPreview] = useState<SupportBundlePreviewV1 | null>(null);
  const [supportStatus, setSupportStatus] = useState<string | null>(null);
  const [supportBusy, setSupportBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedSources = useMemo<LogStreamV1[]>(
    () => (source === "all" ? [...ALL_SOURCES] : [source]),
    [source],
  );
  const query = useMemo<DiagnosticLogQueryV1>(() => {
    const duration = timeRangeMs(range);
    return {
      sources: selectedSources,
      ...(duration !== null ? { sinceTime: Date.now() - duration } : {}),
      minLevel,
      ...(pluginId.trim() !== "" ? { pluginId: pluginId.trim() } : {}),
      ...(text.trim() !== "" ? { text: text.trim() } : {}),
      limit: MAX_VIEW_RECORDS,
    };
  }, [minLevel, pluginId, range, selectedSources, text]);
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    if (!openFeed || paused) return;
    let cancelled = false;
    let disposeLocal: (() => Promise<void>) | null = null;
    let disposeRemote: (() => void) | null = null;
    const parsed = JSON.parse(queryKey) as DiagnosticLogQueryV1;
    const localSources = parsed.sources.filter((entry) => LOCAL_SOURCES.has(entry));
    const remoteSources = parsed.sources.filter((entry) => !LOCAL_SOURCES.has(entry));
    setLocalFeed({ snapshot: null, error: null });
    setRemoteFeed({ snapshot: null, error: null });

    if (host !== undefined && localSources.length > 0) {
      void host
        .subscribe({ ...parsed, sources: localSources }, (incoming) => {
          if (cancelled) return;
          if (incoming.kind === "snapshot") {
            setLocalFeed({ snapshot: incoming.payload, error: null });
          } else {
            setLocalFeed((previous) => ({
              snapshot: applyDelta(previous.snapshot, incoming.payload),
              error: null,
            }));
          }
        })
        .then((subscription) => {
          if (cancelled) {
            void subscription.dispose();
            return;
          }
          disposeLocal = subscription.dispose;
          setLocalFeed({ snapshot: subscription.snapshot, error: null });
        })
        .catch((error: unknown) => {
          if (!cancelled) setLocalFeed({ snapshot: null, error: message(error) });
        });
    } else {
      setLocalFeed({
        snapshot: null,
        error: localSources.length > 0 ? "Electron diagnostics unavailable" : null,
      });
    }

    if (remoteSources.length > 0) {
      void client
        .subscribe("diagnostics.subscribe", { ...parsed, sources: remoteSources }, (raw, kind) => {
          if (cancelled) return;
          if (kind === "snapshot" && isSnapshot(raw)) {
            setRemoteFeed({ snapshot: raw, error: null });
          } else if (kind === "delta" && isDelta(raw)) {
            setRemoteFeed((previous) => ({
              snapshot: applyDelta(previous.snapshot, raw),
              error: null,
            }));
          }
        })
        .then((subscription) => {
          if (cancelled) {
            subscription.unsubscribe();
            return;
          }
          disposeRemote = subscription.unsubscribe;
          if (isSnapshot(subscription.snapshot)) {
            setRemoteFeed({ snapshot: subscription.snapshot, error: null });
          } else {
            setRemoteFeed({ snapshot: null, error: "fieldd returned an invalid snapshot" });
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) setRemoteFeed({ snapshot: null, error: message(error) });
        });
    }

    return () => {
      cancelled = true;
      void disposeLocal?.();
      disposeRemote?.();
    };
  }, [client, host, openFeed, paused, queryKey]);

  const refreshLeases = useCallback(async (): Promise<void> => {
    const rows: LeaseRow[] = [];
    const failures: string[] = [];
    if (host !== undefined) {
      try {
        const local = await host.listLeases();
        rows.push(...local.leases.map((lease) => ({ origin: "electron" as const, lease })));
      } catch (error) {
        failures.push(message(error));
      }
    }
    try {
      const remote = leaseList(await client.request("diagnostics.lease.list"));
      if (remote === null) throw new Error("fieldd returned an invalid lease list");
      rows.push(...remote.leases.map((lease) => ({ origin: "fieldd" as const, lease })));
    } catch (error) {
      failures.push(message(error));
    }
    setLeases(rows.sort((left, right) => left.lease.expiresAt - right.lease.expiresAt));
    setLeaseError(failures.length > 0 ? failures.join(" · ") : null);
  }, [client, host]);

  useEffect(() => {
    void refreshLeases();
    if (host === undefined) return;
    let cancelled = false;
    void host
      .listCrashes()
      .then((list) => {
        if (!cancelled) setCrashes(list);
      })
      .catch(() => {
        if (!cancelled) setCrashes(null);
      });
    return () => {
      cancelled = true;
    };
  }, [host, refreshLeases]);

  const records = useMemo(
    () =>
      mergeRecords(localFeed.snapshot?.records ?? [], remoteFeed.snapshot?.records ?? []).filter(
        (record) => {
          if (
            component.trim() !== "" &&
            !record.component.toLocaleLowerCase().includes(component.trim().toLocaleLowerCase())
          ) {
            return false;
          }
          if (
            event.trim() !== "" &&
            !record.event.toLocaleLowerCase().includes(event.trim().toLocaleLowerCase())
          ) {
            return false;
          }
          if (
            boot.trim() !== "" &&
            !record.bootId.toLocaleLowerCase().includes(boot.trim().toLocaleLowerCase())
          ) {
            return false;
          }
          if (
            traceId.trim() !== "" &&
            !record.traceId?.toLocaleLowerCase().includes(traceId.trim().toLocaleLowerCase())
          ) {
            return false;
          }
          if (
            operationId.trim() !== "" &&
            !record.operationId
              ?.toLocaleLowerCase()
              .includes(operationId.trim().toLocaleLowerCase())
          ) {
            return false;
          }
          if (
            sessionId.trim() !== "" &&
            !record.sessionId?.toLocaleLowerCase().includes(sessionId.trim().toLocaleLowerCase())
          ) {
            return false;
          }
          if (
            docId.trim() !== "" &&
            !record.docId?.toLocaleLowerCase().includes(docId.trim().toLocaleLowerCase())
          ) {
            return false;
          }
          return true;
        },
      ),
    [
      boot,
      component,
      docId,
      event,
      localFeed.snapshot?.records,
      operationId,
      remoteFeed.snapshot?.records,
      sessionId,
      traceId,
    ],
  );

  useEffect(() => {
    if (follow && listRef.current !== null) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [follow, records.length]);

  const producers = [
    ...(localFeed.snapshot?.producers ?? []),
    ...(remoteFeed.snapshot?.producers ?? []),
  ];
  const dropped =
    (localFeed.snapshot?.droppedBefore ?? 0) + (remoteFeed.snapshot?.droppedBefore ?? 0);
  const parseFailures =
    (localFeed.snapshot?.history?.parseFailures ?? 0) +
    (remoteFeed.snapshot?.history?.parseFailures ?? 0);
  const unsafeSegments =
    (localFeed.snapshot?.history?.skippedUnsafeSegments ?? 0) +
    (remoteFeed.snapshot?.history?.skippedUnsafeSegments ?? 0);
  const writerFailures = producers.filter((producer) => producer.health.writerState !== "healthy");
  const clockSkewed = records.filter(
    (record) =>
      record.observedTime !== undefined && Math.abs(record.observedTime - record.time) > 5_000,
  ).length;
  const transportTruncation =
    transportTruncated(localFeed.snapshot) + transportTruncated(remoteFeed.snapshot);
  const historyLimited =
    Number(localFeed.snapshot?.history?.truncated === true) +
    Number(remoteFeed.snapshot?.history?.truncated === true);
  const truncated =
    records.filter((record) => record.truncation !== undefined).length + transportTruncation;

  const createLease = async (): Promise<void> => {
    if (host === undefined && leaseTarget !== "fieldd") {
      setLeaseError("Electron diagnostics are unavailable");
      return;
    }
    let request: DiagnosticLeaseCreateV1;
    let local = false;
    let remote = false;
    if (leaseTarget === "plugin") {
      if (leasePlugin.trim() === "") {
        setLeaseError("plugin id is required");
        return;
      }
      request = {
        selector: {
          kind: "plugin",
          pluginId: leasePlugin.trim(),
          ...(leasePluginEntry === "both" ? {} : { entry: leasePluginEntry }),
        },
        level: leaseLevel,
        duration: leaseDuration,
      };
      local = leasePluginEntry === "both" || leasePluginEntry === "renderer";
      remote = leasePluginEntry === "both" || leasePluginEntry === "service";
    } else {
      request = {
        selector:
          leaseComponent.trim() === ""
            ? { kind: "service", service: leaseTarget }
            : {
                kind: "component",
                service: leaseTarget,
                component: leaseComponent.trim(),
              },
        level: leaseLevel,
        duration: leaseDuration,
      };
      local = leaseTarget !== "fieldd";
      remote = leaseTarget === "fieldd";
    }

    setLeaseBusy(true);
    setLeaseError(null);
    let localLease: DiagnosticLeaseV1 | null = null;
    try {
      if (local) localLease = (await host?.createLease(request)) ?? null;
      if (remote) await client.request("diagnostics.lease.create", request);
      await refreshLeases();
    } catch (error) {
      if (localLease !== null) {
        await host?.revokeLease({ leaseId: localLease.leaseId }).catch(() => undefined);
      }
      setLeaseError(message(error));
    } finally {
      setLeaseBusy(false);
    }
  };

  const revokeLease = async (row: LeaseRow): Promise<void> => {
    setLeaseBusy(true);
    setLeaseError(null);
    try {
      if (row.origin === "electron") {
        await host?.revokeLease({ leaseId: row.lease.leaseId });
      } else {
        await client.request("diagnostics.lease.revoke", {
          leaseId: row.lease.leaseId,
        });
      }
      await refreshLeases();
    } catch (error) {
      setLeaseError(message(error));
    } finally {
      setLeaseBusy(false);
    }
  };

  const previewSupport = async (): Promise<void> => {
    if (host === undefined) return;
    const now = Date.now();
    const duration = timeRangeMs(range) ?? 24 * 60 * 60 * 1_000;
    const sources = source === "all" ? [...SYSTEM_SOURCES] : [source];
    if (sources.some((entry) => entry.startsWith("plugins/")) && pluginId.trim() === "") {
      setSupportStatus("Select an exact plugin id before including plugin logs.");
      return;
    }
    setSupportBusy(true);
    setSupportStatus(null);
    try {
      const preview = await host.previewSupport({
        range: { from: now - duration, to: now },
        sources,
        pluginIds: sources.some((entry) => entry.startsWith("plugins/")) ? [pluginId.trim()] : [],
        includeAudit: false,
        crashArtifactIds: [...selectedCrashes],
      });
      setSupportPreview(preview);
    } catch (error) {
      setSupportStatus(message(error));
    } finally {
      setSupportBusy(false);
    }
  };

  const exportSupport = async (): Promise<void> => {
    if (host === undefined || supportPreview === null) return;
    setSupportBusy(true);
    setSupportStatus(null);
    try {
      const result = await host.exportSupport({
        previewId: supportPreview.previewId,
      });
      setSupportStatus(
        result.status === "exported"
          ? `Exported ${formatBytes(result.archiveBytes ?? 0)} locally.`
          : "Export cancelled; no archive was written.",
      );
      if (result.status === "exported") setSupportPreview(null);
    } catch (error) {
      setSupportStatus(message(error));
    } finally {
      setSupportBusy(false);
    }
  };

  return (
    <div className="border-t border-neutral-100 pt-2 dark:border-neutral-700">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpenFeed((value) => !value)}
      >
        <span className="text-neutral-400 dark:text-neutral-500">Diagnostics</span>
        <span className={labelCls}>{openFeed ? "▾" : "▸"}</span>
      </button>
      {openFeed && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-4 gap-1">
            <select
              aria-label="Diagnostic source"
              className={inputCls}
              value={source}
              onChange={(event) => setSource(event.target.value as LogStreamV1 | "all")}
            >
              <option value="all">all sources</option>
              {ALL_SOURCES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
            <select
              aria-label="Diagnostic time range"
              className={inputCls}
              value={range}
              onChange={(event) => setRange(event.target.value)}
            >
              <option value="15m">last 15m</option>
              <option value="1h">last hour</option>
              <option value="24h">last 24h</option>
              <option value="all">retained</option>
            </select>
            <select
              aria-label="Minimum diagnostic level"
              className={inputCls}
              value={minLevel}
              onChange={(event) => setMinLevel(event.target.value as LogLevelNameV1)}
            >
              {LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}+
                </option>
              ))}
            </select>
            <input
              aria-label="Diagnostic full-text filter"
              className={inputCls}
              placeholder="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <input
              aria-label="Diagnostic component filter"
              className={inputCls}
              placeholder="component"
              value={component}
              onChange={(event) => setComponent(event.target.value)}
            />
            <input
              aria-label="Diagnostic event filter"
              className={inputCls}
              placeholder="event"
              value={event}
              onChange={(change) => setEvent(change.target.value)}
            />
            <input
              aria-label="Diagnostic boot filter"
              className={inputCls}
              placeholder="process boot"
              value={boot}
              onChange={(change) => setBoot(change.target.value)}
            />
            <input
              aria-label="Diagnostic plugin filter"
              className={inputCls}
              placeholder="exact plugin id"
              value={pluginId}
              onChange={(change) => setPluginId(change.target.value)}
            />
            <input
              aria-label="Diagnostic trace id filter"
              className={inputCls}
              placeholder="trace id"
              value={traceId}
              onChange={(change) => setTraceId(change.target.value)}
            />
            <input
              aria-label="Diagnostic operation id filter"
              className={inputCls}
              placeholder="operation id"
              value={operationId}
              onChange={(change) => setOperationId(change.target.value)}
            />
            <input
              aria-label="Diagnostic session id filter"
              className={inputCls}
              placeholder="session id"
              value={sessionId}
              onChange={(change) => setSessionId(change.target.value)}
            />
            <input
              aria-label="Diagnostic document id filter"
              className={inputCls}
              placeholder="document id"
              value={docId}
              onChange={(change) => setDocId(change.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded bg-neutral-50 px-2 py-1 dark:bg-neutral-800">
            <span>
              {records.length} / {MAX_VIEW_RECORDS} records
            </span>
            <span>{producers.length} producers</span>
            <span className={dropped > 0 ? "text-orange-600 dark:text-orange-400" : labelCls}>
              {dropped} dropped
            </span>
            <span className={parseFailures > 0 ? "text-orange-600 dark:text-orange-400" : labelCls}>
              {parseFailures} corrupt
            </span>
            <span
              className={unsafeSegments > 0 ? "text-orange-600 dark:text-orange-400" : labelCls}
            >
              {unsafeSegments} unsafe
            </span>
            <span
              className={writerFailures.length > 0 ? "text-red-600 dark:text-red-400" : labelCls}
            >
              {writerFailures.length} writer failures
            </span>
            <span className={clockSkewed > 0 ? "text-orange-600 dark:text-orange-400" : labelCls}>
              {clockSkewed} skewed
            </span>
            <span className={truncated > 0 ? "text-orange-600 dark:text-orange-400" : labelCls}>
              {truncated} truncated
            </span>
            <span
              className={historyLimited > 0 ? "text-orange-600 dark:text-orange-400" : labelCls}
            >
              {historyLimited} scan-limited
            </span>
          </div>

          {(localFeed.error !== null || remoteFeed.error !== null) && (
            <div className="rounded bg-red-50 px-2 py-1 text-red-700 dark:bg-red-950 dark:text-red-300">
              {[localFeed.error, remoteFeed.error].filter(Boolean).join(" · ")}
            </div>
          )}

          <div className="flex gap-1">
            <button type="button" className={buttonCls} onClick={() => setPaused((v) => !v)}>
              {paused ? "Resume" : "Pause"}
            </button>
            <button type="button" className={buttonCls} onClick={() => setFollow((v) => !v)}>
              Follow {follow ? "on" : "off"}
            </button>
            <button
              type="button"
              className={buttonCls}
              disabled={host === undefined}
              onClick={() => void host?.openLogs()}
            >
              Open logs
            </button>
          </div>

          <div
            ref={listRef}
            data-testid="diagnostic-records"
            className="max-h-72 overflow-auto rounded border border-neutral-200 bg-neutral-950 text-neutral-200 dark:border-neutral-700"
          >
            {records.length === 0 ? (
              <div className="p-2 text-neutral-500">
                {paused ? "Live diagnostics paused." : "No matching records."}
              </div>
            ) : (
              records.map((record) => (
                <details
                  key={recordKey(record)}
                  className="border-b border-neutral-800 px-2 py-1 last:border-b-0"
                >
                  <summary className="flex cursor-pointer list-none items-start gap-2">
                    <span className="w-20 flex-none text-neutral-500">
                      {new Date(record.time).toLocaleTimeString()}
                    </span>
                    <span
                      className={
                        record.level >= LEVEL_NUMBER.error
                          ? "w-10 flex-none text-red-400"
                          : record.level >= LEVEL_NUMBER.warn
                            ? "w-10 flex-none text-orange-400"
                            : "w-10 flex-none text-neutral-400"
                      }
                    >
                      {record.severity.toLowerCase()}
                    </span>
                    <span className="w-28 flex-none truncate text-cyan-300">
                      {sourceOf(record)}
                    </span>
                    <span className="w-28 flex-none truncate text-neutral-400">
                      {record.component}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-neutral-200">{record.event}</span>
                      <span className="ml-2 text-neutral-400">{record.msg}</span>
                    </span>
                    <button
                      type="button"
                      className="flex-none text-neutral-500 hover:text-neutral-200"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void host?.copyText(JSON.stringify(record, null, 2));
                      }}
                    >
                      copy
                    </button>
                  </summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-[10px] text-neutral-400">
                    {JSON.stringify(record, null, 2)}
                  </pre>
                </details>
              ))
            )}
          </div>

          <details>
            <summary className="cursor-pointer text-neutral-400 dark:text-neutral-500">
              Producers & diagnostic leases ({leases.length})
            </summary>
            <div className="mt-1 space-y-1">
              {producers.map((producer) => (
                <div
                  key={producer.producerId}
                  className="flex items-center justify-between gap-2 rounded bg-neutral-50 px-2 py-1 dark:bg-neutral-800"
                >
                  <span className="truncate">
                    {producer.stream} · {producer.health.currentLevel}
                  </span>
                  <span
                    className={
                      producer.health.writerState === "healthy"
                        ? labelCls
                        : "text-red-600 dark:text-red-400"
                    }
                  >
                    {producer.health.writerState} · {producer.health.activeLeaseCount} leases
                  </span>
                </div>
              ))}
              <div className="grid grid-cols-6 gap-1">
                <select
                  aria-label="Diagnostic lease target"
                  className={inputCls}
                  value={leaseTarget}
                  onChange={(change) =>
                    setLeaseTarget(
                      change.target.value as
                        | "desktop"
                        | "renderer"
                        | "utility"
                        | "fieldd"
                        | "plugin",
                    )
                  }
                >
                  <option value="fieldd">fieldd</option>
                  <option value="desktop">desktop</option>
                  <option value="renderer">renderer</option>
                  <option value="utility">utility</option>
                  <option value="plugin">plugin</option>
                </select>
                {leaseTarget === "plugin" ? (
                  <>
                    <input
                      aria-label="Diagnostic lease plugin id"
                      className={`${inputCls} col-span-2`}
                      placeholder="plugin id"
                      value={leasePlugin}
                      onChange={(change) => setLeasePlugin(change.target.value)}
                    />
                    <select
                      aria-label="Diagnostic lease plugin entry"
                      className={inputCls}
                      value={leasePluginEntry}
                      onChange={(change) =>
                        setLeasePluginEntry(change.target.value as "both" | "renderer" | "service")
                      }
                    >
                      <option value="both">both entries</option>
                      <option value="renderer">renderer</option>
                      <option value="service">service</option>
                    </select>
                  </>
                ) : (
                  <input
                    aria-label="Diagnostic lease component"
                    className={`${inputCls} col-span-3`}
                    placeholder="component (optional)"
                    value={leaseComponent}
                    onChange={(change) => setLeaseComponent(change.target.value)}
                  />
                )}
                <select
                  aria-label="Diagnostic lease level"
                  className={inputCls}
                  value={leaseLevel}
                  onChange={(change) => setLeaseLevel(change.target.value as "trace" | "debug")}
                >
                  <option value="debug">debug</option>
                  <option value="trace">trace</option>
                </select>
                <select
                  aria-label="Diagnostic lease duration"
                  className={inputCls}
                  value={leaseDuration}
                  onChange={(change) =>
                    setLeaseDuration(change.target.value as "15m" | "1h" | "until-restart")
                  }
                >
                  <option value="15m">15m</option>
                  <option value="1h">1h</option>
                  <option value="until-restart">restart</option>
                </select>
              </div>
              <button
                type="button"
                className={buttonCls}
                disabled={leaseBusy}
                onClick={() => void createLease()}
              >
                Create temporary lease
              </button>
              {leases.map((row) => (
                <div
                  key={`${row.origin}:${row.lease.leaseId}`}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="min-w-0 truncate">
                    {row.origin} · {row.lease.selector.kind} · {row.lease.level} ·{" "}
                    {remaining(row.lease.expiresAt)}
                  </span>
                  <button
                    type="button"
                    className={buttonCls}
                    disabled={leaseBusy}
                    onClick={() => void revokeLease(row)}
                  >
                    revoke
                  </button>
                </div>
              ))}
              {leaseError !== null && (
                <div className="text-red-600 dark:text-red-400">{leaseError}</div>
              )}
            </div>
          </details>

          <details>
            <summary className="cursor-pointer text-neutral-400 dark:text-neutral-500">
              Crash artifacts ({crashes?.artifacts.length ?? 0})
            </summary>
            <div className="mt-1 space-y-1">
              {crashes?.artifacts.length === 0 && (
                <div className={labelCls}>No retained local crash artifacts.</div>
              )}
              {crashes?.artifacts.map((artifact) => (
                <div
                  key={artifact.artifactId}
                  className="flex items-center justify-between gap-2 rounded bg-neutral-50 px-2 py-1 dark:bg-neutral-800"
                >
                  <label className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedCrashes.has(artifact.artifactId)}
                      onChange={(change) => {
                        setSelectedCrashes((current) => {
                          const next = new Set(current);
                          if (change.target.checked) next.add(artifact.artifactId);
                          else next.delete(artifact.artifactId);
                          return next;
                        });
                      }}
                    />
                    <span className="truncate">
                      {artifact.processRole} · {new Date(artifact.createdAt).toLocaleString()}
                    </span>
                  </label>
                  <span className="flex items-center gap-1">
                    <span className={labelCls}>{formatBytes(artifact.bytes)}</span>
                    {!artifact.viewed && (
                      <button
                        type="button"
                        className={buttonCls}
                        onClick={() => {
                          void host
                            ?.markCrashViewed({ artifactId: artifact.artifactId })
                            .then(() => host.listCrashes())
                            .then(setCrashes)
                            .catch(() => undefined);
                        }}
                      >
                        mark reviewed
                      </button>
                    )}
                  </span>
                </div>
              ))}
              {(crashes?.cleanup.failures ?? 0) > 0 && (
                <div className="text-red-600 dark:text-red-400">
                  {crashes?.cleanup.failures} crash cleanup failures
                </div>
              )}
            </div>
          </details>

          <div className="rounded border border-neutral-200 p-2 dark:border-neutral-700">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div>Support bundle</div>
                <div className={labelCls}>
                  No upload. “All sources” defaults to first-party system logs only.
                </div>
              </div>
              <button
                type="button"
                className={buttonCls}
                disabled={host === undefined || supportBusy}
                onClick={() => void previewSupport()}
              >
                Preview
              </button>
            </div>
            {supportPreview !== null && (
              <div className="mt-2 space-y-1 rounded bg-neutral-50 p-2 dark:bg-neutral-800">
                <div>
                  {formatBytes(supportPreview.estimatedUncompressedBytes)} uncompressed ·{" "}
                  {supportPreview.manifest.files.length} files ·{" "}
                  {supportPreview.manifest.omittedRecords} omitted ·{" "}
                  {supportPreview.manifest.truncatedRecords} truncated
                </div>
                <div className={labelCls}>{supportPreview.manifest.sources.join(", ")}</div>
                {supportPreview.warnings.map((warning) => (
                  <div key={warning} className="text-orange-700 dark:text-orange-300">
                    {warning}
                  </div>
                ))}
                <button
                  type="button"
                  className={buttonCls}
                  disabled={supportBusy}
                  onClick={() => void exportSupport()}
                >
                  Export preview…
                </button>
              </div>
            )}
            {supportStatus !== null && <div className="mt-1">{supportStatus}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export {
  applyDelta as applyDiagnosticDelta,
  mergeRecords as mergeDiagnosticRecords,
  sourceOf as diagnosticSourceOf,
};
