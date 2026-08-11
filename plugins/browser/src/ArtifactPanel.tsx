import {
  ArtifactRefreshPreviewResult,
  type ArtifactView,
  ArtifactView as ArtifactViewSchema,
} from "@vibefield/contracts";
import type { PluginProductClient, PluginSurfaceProps } from "@vibefield/plugin-sdk";
import {
  EmptyState,
  InlineNotice,
  PlaceholderFace,
  StatusDot,
  UiButton,
  uiFieldClass,
} from "@vibefield/plugin-sdk/ui";
import {
  type FormEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./artifact-panel.css";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const THUMBNAIL_RETRY_DELAYS_MS = [500, 1_500] as const;

export function createUlid(now = Date.now()): string {
  let time = BigInt(now);
  let prefix = "";
  for (let index = 0; index < 10; index += 1) {
    prefix = CROCKFORD[Number(time & 31n)] + prefix;
    time >>= 5n;
  }
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let random = 0n;
  for (const byte of bytes) random = (random << 8n) | BigInt(byte);
  let suffix = "";
  for (let index = 0; index < 16; index += 1) {
    suffix = CROCKFORD[Number(random & 31n)] + suffix;
    random >>= 5n;
  }
  return `${prefix}${suffix}`;
}

export function pathBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.split(/[\\/]/).pop() || "Folder";
}

export function parseArtifactSnapshot(value: unknown): ArtifactView[] | null {
  const parsed = ArtifactViewSchema.array().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function friendlyError(error: unknown, action: string): string {
  const kind =
    typeof error === "object" && error !== null && "kind" in error
      ? String((error as { kind: unknown }).kind)
      : "";
  const details =
    typeof error === "object" && error !== null && "details" in error
      ? (error as { details?: unknown }).details
      : undefined;
  const detailCode =
    typeof details === "object" &&
    details !== null &&
    "code" in details &&
    typeof (details as { code?: unknown }).code === "string"
      ? (details as { code: string }).code
      : "";
  if (detailCode === "STATIC_ROOT_INVALID") {
    return "That folder cannot be served. Choose another folder.";
  }
  if (kind === "UNAVAILABLE") return "Desktop services are unavailable. Try again in a moment.";
  if (kind === "UNAUTHORIZED" || kind === "FORBIDDEN_SCOPE")
    return `Browser does not have permission to ${action}.`;
  if (kind === "CONFLICT") return "That operation is already in progress. Try again shortly.";
  if (kind === "RESOURCE_EXHAUSTED") return "The artifact limit has been reached.";
  if (kind === "NOT_FOUND") {
    return action === "load artifacts"
      ? "Artifact services are unavailable in this build."
      : "That artifact no longer exists.";
  }
  return `Could not ${action}. Try again.`;
}

function statusTone(
  status: ArtifactView["availability"],
): "attention" | "error" | "healthy" | "muted" {
  if (status === "active") return "healthy";
  if (status === "source-unavailable") return "attention";
  if (status === "error") return "error";
  return "muted";
}

function statusLabel(status: ArtifactView["availability"]): string {
  return status.replaceAll("-", " ");
}

function thumbnailAttemptUrl(url: string, attempt: number): string {
  if (attempt === 0) return url;
  const retry = new URL(url);
  retry.searchParams.set("vf-preview-attempt", String(attempt));
  return retry.toString();
}

type Screen =
  | { kind: "catalog" }
  | { kind: "choose" }
  | { kind: "proxy" }
  | { kind: "folder"; path: string; title: string };

type CatalogState =
  | { phase: "loading" }
  | { phase: "live"; artifacts: ArtifactView[] }
  | { phase: "error"; message: string };

export function ArtifactPanel({
  client,
  surface,
}: {
  client: PluginProductClient;
  surface: PluginSurfaceProps;
}): ReactElement {
  const [catalog, setCatalog] = useState<CatalogState>({ phase: "loading" });
  const [subscriptionEpoch, setSubscriptionEpoch] = useState(0);
  const [screen, setScreen] = useState<Screen>({ kind: "catalog" });
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ artifactId: string; title: string } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: subscriptionEpoch is the explicit user-triggered retry signal.
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    setCatalog({ phase: "loading" });
    const apply = (value: unknown) => {
      if (disposed) return;
      const artifacts = parseArtifactSnapshot(value);
      if (artifacts === null) {
        setCatalog({ phase: "error", message: "The artifact catalog could not be read." });
        return;
      }
      setCatalog({ phase: "live", artifacts });
    };
    void client
      .subscribe("artifact.subscribe", {}, apply)
      .then((subscription) => {
        if (disposed) {
          subscription.unsubscribe();
          return;
        }
        unsubscribe = subscription.unsubscribe;
        apply(subscription.snapshot);
      })
      .catch((error: unknown) => {
        if (!disposed)
          setCatalog({ phase: "error", message: friendlyError(error, "load artifacts") });
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [client, subscriptionEpoch]);

  useEffect(() => {
    if (confirmRemove === null) return;
    const timer = window.setTimeout(() => setConfirmRemove(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [confirmRemove]);

  const artifacts = catalog.phase === "live" ? catalog.artifacts : [];
  const count = artifacts.length;

  const beginPending = useCallback((operation: string): boolean => {
    if (pendingRef.current !== null) return false;
    pendingRef.current = operation;
    setPending(operation);
    return true;
  }, []);

  const finishPending = useCallback((operation: string): void => {
    if (pendingRef.current !== operation) return;
    pendingRef.current = null;
    setPending(null);
  }, []);

  const returnToCatalog = useCallback(() => {
    setMutationError(null);
    setConfirmRemove(null);
    setScreen({ kind: "catalog" });
  }, []);

  const publish = useCallback(
    async (title: string, source: Record<string, unknown>) => {
      const operation = "publish";
      if (!beginPending(operation)) return;
      setMutationError(null);
      try {
        await client.request("artifact.publish", {
          artifactId: createUlid(),
          idempotencyKey: createUlid(),
          title,
          source,
        });
        setScreen({ kind: "catalog" });
      } catch (error) {
        setMutationError(friendlyError(error, "publish this artifact"));
      } finally {
        finishPending(operation);
      }
    },
    [beginPending, client, finishPending],
  );

  const openArtifact = useCallback(
    async (artifact: ArtifactView) => {
      if (!artifact.openable || artifact.url === undefined) return;
      const operation = `open:${artifact.artifactKey}`;
      if (!beginPending(operation)) return;
      setMutationError(null);
      try {
        await client.request("shell.openExternal", { url: artifact.url });
      } catch (error) {
        setMutationError(friendlyError(error, "open this artifact"));
      } finally {
        finishPending(operation);
      }
    },
    [beginPending, client, finishPending],
  );

  const copyUrl = useCallback(async (artifact: ArtifactView) => {
    if (artifact.url === undefined) return;
    setMutationError(null);
    try {
      await navigator.clipboard.writeText(artifact.url);
      setConfirmRemove(null);
    } catch {
      setMutationError("Could not copy the URL. Copy permission may be disabled.");
    }
  }, []);

  const removeArtifact = useCallback(
    async (artifact: ArtifactView) => {
      if (!artifact.editable) return;
      if (confirmRemove !== artifact.artifactKey) {
        setConfirmRemove(artifact.artifactKey);
        return;
      }
      const operation = `remove:${artifact.artifactKey}`;
      if (!beginPending(operation)) return;
      setMutationError(null);
      try {
        await client.request("artifact.unpublish", { artifactId: artifact.artifactId });
        setConfirmRemove(null);
      } catch (error) {
        setMutationError(friendlyError(error, "remove this artifact"));
      } finally {
        finishPending(operation);
      }
    },
    [beginPending, client, confirmRemove, finishPending],
  );

  const refreshPreview = useCallback(
    async (artifact: ArtifactView) => {
      if (!artifact.editable) return;
      const operation = `preview:${artifact.artifactKey}`;
      if (!beginPending(operation)) return;
      setMutationError(null);
      try {
        const raw = await client.request("artifact.refreshPreview", {
          artifactId: artifact.artifactId,
        });
        const result = ArtifactRefreshPreviewResult.safeParse(raw);
        if (!result.success) {
          setMutationError("The preview service returned an unreadable result.");
        } else if (!result.data.captured) {
          setMutationError(result.data.reason);
        }
      } catch (error) {
        setMutationError(friendlyError(error, "refresh this preview"));
      } finally {
        finishPending(operation);
      }
    },
    [beginPending, client, finishPending],
  );

  const renameArtifact = useCallback(
    async (event: FormEvent, artifact: ArtifactView) => {
      event.preventDefault();
      const title = renaming?.title.trim() ?? "";
      if (title.length === 0 || title === artifact.title) {
        setRenaming(null);
        return;
      }
      const operation = `rename:${artifact.artifactKey}`;
      if (!beginPending(operation)) return;
      setMutationError(null);
      try {
        await client.request("artifact.update", { artifactId: artifact.artifactId, title });
        setRenaming(null);
      } catch (error) {
        setMutationError(friendlyError(error, "rename this artifact"));
      } finally {
        finishPending(operation);
      }
    },
    [beginPending, client, finishPending, renaming],
  );

  const chooseFolder = useCallback(async () => {
    const operation = "pick-folder";
    if (!beginPending(operation)) return;
    setMutationError(null);
    try {
      const raw = await client.request("shell.dialog.pickFolder", {
        purpose: "artifact.publish",
      });
      if (
        typeof raw !== "object" ||
        raw === null ||
        !("canceled" in raw) ||
        typeof (raw as { canceled?: unknown }).canceled !== "boolean"
      ) {
        setMutationError("The folder picker returned an unreadable result.");
        return;
      }
      if ((raw as { canceled: boolean }).canceled) return;
      const path = (raw as { path?: unknown }).path;
      if (typeof path !== "string" || path.length === 0) {
        setMutationError("The folder picker returned an unreadable result.");
        return;
      }
      setScreen({ kind: "folder", path, title: pathBasename(path) });
    } catch (error) {
      setMutationError(friendlyError(error, "choose a folder"));
    } finally {
      finishPending(operation);
    }
  }, [beginPending, client, finishPending]);

  const content = useMemo(() => {
    if (screen.kind === "choose") {
      return (
        <AddChoice
          pending={pending !== null}
          onBack={returnToCatalog}
          onProxy={() => {
            setMutationError(null);
            setScreen({ kind: "proxy" });
          }}
          onFolder={() => void chooseFolder()}
        />
      );
    }
    if (screen.kind === "proxy") {
      return (
        <ProxyForm
          pending={pending === "publish"}
          onBack={() => setScreen({ kind: "choose" })}
          onPublish={publish}
        />
      );
    }
    if (screen.kind === "folder") {
      return (
        <FolderForm
          key={screen.path}
          path={screen.path}
          initialTitle={screen.title}
          pending={pending === "publish"}
          onBack={() => setScreen({ kind: "choose" })}
          onPublish={publish}
        />
      );
    }
    if (catalog.phase === "loading") {
      return <QuietState title="Loading artifacts" detail="Reading the shared catalog…" />;
    }
    if (catalog.phase === "error") {
      return (
        <QuietState title="Artifacts unavailable" detail={catalog.message}>
          <UiButton
            variant="primary"
            className="vf-artifact-button"
            onClick={() => setSubscriptionEpoch((value) => value + 1)}
          >
            Try again
          </UiButton>
        </QuietState>
      );
    }
    if (artifacts.length === 0) {
      return (
        <QuietState title="No artifacts yet" detail="Add a proxy or folder">
          <UiButton
            variant="primary"
            className="vf-artifact-button"
            onClick={() => {
              setConfirmRemove(null);
              setScreen({ kind: "choose" });
            }}
          >
            Add artifact
          </UiButton>
        </QuietState>
      );
    }
    return (
      <ul className="vf-artifact-list" aria-label="Artifacts">
        {artifacts.map((artifact) => (
          <ArtifactRow
            key={artifact.artifactKey}
            artifact={artifact}
            busy={pending !== null}
            confirmRemove={confirmRemove === artifact.artifactKey}
            renaming={renaming?.artifactId === artifact.artifactId ? renaming.title : null}
            onOpen={() => void openArtifact(artifact)}
            onCopy={() => void copyUrl(artifact)}
            onBeginRename={() => {
              setConfirmRemove(null);
              setRenaming({ artifactId: artifact.artifactId, title: artifact.title });
            }}
            onRenameChange={(title) => setRenaming({ artifactId: artifact.artifactId, title })}
            onRename={(event) => void renameArtifact(event, artifact)}
            onCancelRename={() => setRenaming(null)}
            onRefresh={() => void refreshPreview(artifact)}
            onRemove={() => void removeArtifact(artifact)}
          />
        ))}
      </ul>
    );
  }, [
    artifacts,
    catalog,
    chooseFolder,
    confirmRemove,
    copyUrl,
    openArtifact,
    pending,
    publish,
    refreshPreview,
    removeArtifact,
    renameArtifact,
    renaming,
    returnToCatalog,
    screen,
  ]);

  return (
    <section className="vf-artifact-panel" aria-label="Artifact Hub">
      <header className="vf-artifact-header">
        <div>
          <h2>Artifacts</h2>
          <span>{catalog.phase === "live" ? `${count} shared` : "Shared in your tailnet"}</span>
        </div>
        {screen.kind === "catalog" && (
          <button
            type="button"
            className="vf-artifact-add"
            disabled={pending !== null}
            aria-label="Add artifact"
            title="Add artifact"
            onClick={() => {
              setMutationError(null);
              setConfirmRemove(null);
              setScreen({ kind: "choose" });
            }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </header>

      {mutationError !== null && (
        <InlineNotice className="vf-artifact-inline-error" tone="error" role="alert">
          {mutationError}
        </InlineNotice>
      )}

      {content}

      {surface.slot === "hud.side-panel" && (
        <button type="button" className="vf-artifact-close" onClick={surface.requestClose}>
          Close panel
        </button>
      )}
    </section>
  );
}

function QuietState({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: ReactElement;
}): ReactElement {
  return (
    <EmptyState
      className="vf-artifact-quiet"
      title={title}
      description={detail}
      visual={<PlaceholderFace className="vf-artifact-placeholder" />}
      actions={children}
    />
  );
}

function AddChoice({
  pending,
  onBack,
  onProxy,
  onFolder,
}: {
  pending: boolean;
  onBack: () => void;
  onProxy: () => void;
  onFolder: () => void;
}): ReactElement {
  return (
    <div className="vf-artifact-flow">
      <FlowHeading
        title="Add artifact"
        detail="Choose what this computer should share."
        onBack={onBack}
        disabled={pending}
      />
      <button type="button" className="vf-artifact-choice" onClick={onProxy} disabled={pending}>
        <ChoiceIcon kind="proxy" />
        <span>
          <strong>Proxy</strong>
          <small>Share a local site already running on this computer.</small>
        </span>
        <Chevron />
      </button>
      <button type="button" className="vf-artifact-choice" onClick={onFolder} disabled={pending}>
        <ChoiceIcon kind="folder" />
        <span>
          <strong>Folder</strong>
          <small>Serve a folder as a website with Truffle.</small>
        </span>
        <Chevron />
      </button>
      {pending && <p className="vf-artifact-pending">Waiting for folder…</p>}
    </div>
  );
}

function ProxyForm({
  pending,
  onBack,
  onPublish,
}: {
  pending: boolean;
  onBack: () => void;
  onPublish: (title: string, source: Record<string, unknown>) => Promise<void>;
}): ReactElement {
  const [scheme, setScheme] = useState<"http" | "https">("http");
  const [port, setPort] = useState("");
  const number = Number(port);
  const valid = Number.isInteger(number) && number >= 1 && number <= 65_535;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || pending) return;
    void onPublish(`localhost:${number}`, { kind: "proxy", scheme, port: number });
  };
  return (
    <form className="vf-artifact-flow" onSubmit={submit}>
      <FlowHeading
        title="Proxy a local site"
        detail="Enter the port your site is listening on."
        onBack={onBack}
        disabled={pending}
      />
      <fieldset className="vf-artifact-segmented">
        <legend className="vf-artifact-sr-only">Source protocol</legend>
        {(["http", "https"] as const).map((value) => (
          <button
            key={value}
            type="button"
            data-active={scheme === value}
            aria-pressed={scheme === value}
            onClick={() => setScheme(value)}
            disabled={pending}
          >
            {value.toUpperCase()}
          </button>
        ))}
      </fieldset>
      <label className="vf-artifact-field">
        <span>Local port</span>
        <input
          className={uiFieldClass}
          type="number"
          min="1"
          max="65535"
          inputMode="numeric"
          placeholder="5173"
          value={port}
          onChange={(event) => setPort(event.target.value)}
          disabled={pending}
          autoFocus
        />
      </label>
      <TailnetFact />
      <UiButton type="submit" variant="primary" disabled={!valid || pending}>
        {pending ? "Publishing…" : "Publish proxy"}
      </UiButton>
    </form>
  );
}

function FolderForm({
  path,
  initialTitle,
  pending,
  onBack,
  onPublish,
}: {
  path: string;
  initialTitle: string;
  pending: boolean;
  onBack: () => void;
  onPublish: (title: string, source: Record<string, unknown>) => Promise<void>;
}): ReactElement {
  const [title, setTitle] = useState(initialTitle);
  const [spa, setSpa] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (cleanTitle.length === 0 || pending) return;
    void onPublish(cleanTitle, {
      kind: "folder",
      path,
      ...(spa ? { spaFallback: "/index.html" } : {}),
    });
  };
  return (
    <form className="vf-artifact-flow" onSubmit={submit}>
      <FlowHeading
        title="Share a folder"
        detail="Truffle will publish this folder as a website."
        onBack={onBack}
        disabled={pending}
      />
      <div className="vf-artifact-folder-picked">
        <ChoiceIcon kind="folder" />
        <span>
          <small>Selected folder</small>
          <strong>{pathBasename(path)}</strong>
        </span>
      </div>
      <label className="vf-artifact-field">
        <span>Name</span>
        <input
          className={uiFieldClass}
          value={title}
          maxLength={128}
          onChange={(event) => setTitle(event.target.value)}
          disabled={pending}
        />
      </label>
      <label className="vf-artifact-check">
        <input
          type="checkbox"
          checked={spa}
          onChange={(event) => setSpa(event.target.checked)}
          disabled={pending}
        />
        <span>
          <strong>Single-page app fallback</strong>
          <small>Serve index.html for ordinary missing routes.</small>
        </span>
      </label>
      <TailnetFact />
      <UiButton type="submit" variant="primary" disabled={title.trim().length === 0 || pending}>
        {pending ? "Publishing…" : "Publish folder"}
      </UiButton>
    </form>
  );
}

function ArtifactRow({
  artifact,
  busy,
  confirmRemove,
  renaming,
  onOpen,
  onCopy,
  onBeginRename,
  onRenameChange,
  onRename,
  onCancelRename,
  onRefresh,
  onRemove,
}: {
  artifact: ArtifactView;
  busy: boolean;
  confirmRemove: boolean;
  renaming: string | null;
  onOpen: () => void;
  onCopy: () => void;
  onBeginRename: () => void;
  onRenameChange: (title: string) => void;
  onRename: (event: FormEvent) => void;
  onCancelRename: () => void;
  onRefresh: () => void;
  onRemove: () => void;
}): ReactElement {
  return (
    <li
      className="vf-artifact-row"
      data-muted={artifact.availability === "offline" || artifact.availability === "unknown"}
    >
      <button
        type="button"
        className="vf-artifact-row__open"
        disabled={!artifact.openable || busy}
        onClick={onOpen}
        title={
          artifact.openable
            ? `Open ${artifact.title}`
            : `${artifact.title} is not currently openable`
        }
      >
        <span className="vf-artifact-preview">
          <ArtifactThumbnail
            key={artifact.thumbnailUrl ?? "placeholder"}
            url={artifact.thumbnailUrl}
          />
        </span>
        <span className="vf-artifact-row__facts">
          <strong>{artifact.title}</strong>
          <small>
            {artifact.originDeviceName} · {artifact.kind}
          </small>
          <span className="vf-artifact-status">
            <StatusDot tone={statusTone(artifact.availability)} />
            {statusLabel(artifact.availability)}
          </span>
        </span>
      </button>
      <details className="vf-artifact-menu">
        <summary aria-label={`Actions for ${artifact.title}`} title="Artifact actions">
          •••
        </summary>
        <div>
          <button type="button" onClick={onCopy} disabled={artifact.url === undefined || busy}>
            Copy URL
          </button>
          {artifact.editable && (
            <button type="button" onClick={onRefresh} disabled={busy}>
              Refresh preview
            </button>
          )}
          {artifact.editable && (
            <button type="button" onClick={onBeginRename} disabled={busy}>
              Rename
            </button>
          )}
          {artifact.editable && (
            <button type="button" className="vf-artifact-danger" onClick={onRemove} disabled={busy}>
              {confirmRemove ? "Confirm remove" : "Remove"}
            </button>
          )}
        </div>
      </details>
      {renaming !== null && (
        <form className="vf-artifact-rename" onSubmit={onRename}>
          <input
            className={uiFieldClass}
            autoFocus
            value={renaming}
            maxLength={128}
            onChange={(event) => onRenameChange(event.target.value)}
          />
          <button type="submit" disabled={busy || renaming.trim().length === 0}>
            Save
          </button>
          <button type="button" onClick={onCancelRename}>
            Cancel
          </button>
        </form>
      )}
    </li>
  );
}

/** A newly published tailnet listener can lose its first image race even
 * though the atomic preview file is already committed. Retry that transport
 * read twice with a distinct cache key; capture remains add-time/gesture-only
 * and a persistent failure settles on the bundled placeholder. */
function ArtifactThumbnail({ url }: { url: string | undefined }): ReactElement {
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    if (!waiting) return;
    const delay = THUMBNAIL_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) return;
    const timer = window.setTimeout(() => {
      setAttempt((value) => value + 1);
      setWaiting(false);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [attempt, waiting]);

  if (url === undefined || waiting || exhausted) return <span aria-hidden="true" />;
  const src = thumbnailAttemptUrl(url, attempt);
  return (
    <img
      key={src}
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => {
        if (attempt >= THUMBNAIL_RETRY_DELAYS_MS.length) {
          setExhausted(true);
        } else {
          setWaiting(true);
        }
      }}
    />
  );
}

function FlowHeading({
  title,
  detail,
  onBack,
  disabled = false,
}: {
  title: string;
  detail: string;
  onBack: () => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <div className="vf-artifact-flow-heading">
      <button type="button" onClick={onBack} aria-label="Back" disabled={disabled}>
        <Chevron back />
      </button>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}

function TailnetFact(): ReactElement {
  return (
    <p className="vf-artifact-fact">Opens on devices connected to this tailnet with Tailscale</p>
  );
}

function ChoiceIcon({ kind }: { kind: "proxy" | "folder" }): ReactElement {
  return kind === "proxy" ? (
    <svg className="vf-artifact-choice-icon" aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4a13 13 0 0 1 0 16M12 4a13 13 0 0 0 0 16" />
    </svg>
  ) : (
    <svg className="vf-artifact-choice-icon" aria-hidden="true" viewBox="0 0 24 24">
      <path d="M3 7.5h7l2-2h9v13H3z" />
    </svg>
  );
}

function Chevron({ back = false }: { back?: boolean }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`vf-artifact-chevron${back ? " is-back" : ""}`}
    >
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}
