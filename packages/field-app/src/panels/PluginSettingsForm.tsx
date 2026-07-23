import type { SettingsContribution } from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useEffect, useState } from "react";
import { labelCls } from "./SettingsPanel";

// PLUG-P5 UI — the GENERATED per-plugin settings pane (plugin spec §21.6 item 1:
// settings UI rendered from declared schemas, no plugin UI code). Extends
// PluginsSection: a plugin whose contributions declare `settings` (§8.5) gains a
// disclosure that mounts this form. Every control is DRIVEN by the property's
// JSON Schema — the v1 form subset ONLY (string · number/integer · boolean ·
// enum); anything outside it renders an honest "unsupported schema" row, never a
// crash (DESIGN.md §8: a state is rendered, never blank).
//
// Storage seam (§16.2/§22.3): storage.settings.get/set/reset over the fieldd
// client. NO optimistic state — every write re-gets its key (the daemon is the
// truth; ajv-validates on set, and its PRECONDITION_FAILED message surfaces
// inline in the section's muted error voice, DESIGN.md §9). SECRET keys never
// echo a stored value — get returns { isSet, secret } with no value; the field
// shows "•••• set" and commits only a fresh, non-empty entry.
//
// Future refinement: storage.settings.subscribe exists — the pane re-gets on
// expand and after writes instead (no live subscription in v1).

/** The JSON Schema fields the v1 form subset reads. JsonSchemaObject is an
 * opaque passthrough record in the contract; this is the honest view of the
 * keys a form control needs. */
interface SchemaView {
  type?: unknown;
  enum?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  default?: unknown;
}

/** storage.settings.get result (§22.3). SECRET keys carry { isSet, secret:true }
 * and never a `value`. */
interface SettingsValue {
  value?: unknown;
  isSet: boolean;
  secret?: boolean;
}

type ControlKind = "secret" | "enum" | "string" | "integer" | "number" | "boolean" | "unsupported";

/** Secret scope wins (never echo); then enum; then the declared JSON type.
 * Everything else is honestly unsupported in v1. */
function controlKind(scope: string, schema: SchemaView): ControlKind {
  if (scope === "secret") return "secret";
  if (Array.isArray(schema.enum)) return "enum";
  if (schema.type === "string") return "string";
  if (schema.type === "integer") return "integer";
  if (schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  return "unsupported";
}

// Matches the Settings panel's inputCls vocabulary (mono, neutral hairline) — a
// diagnostics SECTION speaks the panel's language, not the card tokens.
const fieldCls =
  "min-w-0 flex-1 rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200";

function SettingRow({
  pluginId,
  settingKey,
  prop,
}: {
  pluginId: string;
  settingKey: string;
  prop: SettingsContribution["properties"][string];
}): ReactElement {
  const client = useFielddClient();
  const schema = prop.schema as SchemaView;
  const kind = controlKind(prop.scope, schema);
  const options = Array.isArray(schema.enum) ? schema.enum : [];

  const [isSet, setIsSet] = useState(false);
  const [value, setValue] = useState<unknown>(undefined); // last committed value (baseline)
  const [draft, setDraft] = useState(""); // text/number/enum(index) editable draft
  const [boolDraft, setBoolDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  // Re-get on mount, on key/plugin change, and after every write (reloadNonce).
  // The daemon is the truth: the fresh get reseeds the draft, so there is no
  // optimistic state to drift.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = (await client.request("storage.settings.get", {
          pluginId,
          key: settingKey,
        })) as SettingsValue;
        if (cancelled) return;
        setError(null);
        setIsSet(res.isSet);
        setValue(res.isSet ? res.value : undefined);
        const current = res.isSet ? res.value : schema.default;
        if (prop.scope === "secret") {
          setDraft(""); // never echo a stored secret
        } else if (kind === "boolean") {
          setBoolDraft(current === true);
        } else if (kind === "enum") {
          const idx = options.findIndex((o) => String(o) === String(current));
          setDraft(idx >= 0 ? String(idx) : "");
        } else {
          setDraft(current === undefined || current === null ? "" : String(current));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // schema/kind/options derive from `prop`; keying on prop covers a schema swap.
  }, [client, pluginId, settingKey, prop, kind, reloadNonce, schema.default]);

  const commit = async (v: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await client.request("storage.settings.set", { pluginId, key: settingKey, value: v });
      setReloadNonce((n) => n + 1); // no optimistic state — re-get the key
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.request("storage.settings.reset", { pluginId, key: settingKey });
      setReloadNonce((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Text/number/secret commit on blur or Enter. Skip no-op writes so a bare
  // focus-blur never persists the default in place; secrets commit any non-empty
  // entry (there is no baseline to diff against).
  const commitText = () => {
    if (prop.scope === "secret") {
      if (draft.length > 0) void commit(draft);
      return;
    }
    const baseline = isSet ? value : schema.default;
    const baselineStr = baseline === undefined || baseline === null ? "" : String(baseline);
    if (draft === baselineStr) return;
    if (kind === "number" || kind === "integer") {
      if (draft.trim() === "") return;
      const n = Number(draft);
      if (Number.isNaN(n)) return; // let the daemon own range; never send NaN
      void commit(n);
    } else {
      void commit(draft);
    }
  };

  const onKey = (e: { key: string }) => {
    if (e.key === "Enter") commitText();
  };

  let control: ReactElement;
  if (kind === "boolean") {
    control = (
      <input
        type="checkbox"
        checked={boolDraft}
        disabled={busy}
        onChange={(e) => {
          setBoolDraft(e.target.checked);
          void commit(e.target.checked);
        }}
      />
    );
  } else if (kind === "enum") {
    control = (
      <select
        className={fieldCls}
        disabled={busy}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          const i = Number(e.target.value);
          if (i >= 0) void commit(options[i]);
        }}
      >
        {draft === "" && <option value="">—</option>}
        {options.map((opt, i) => (
          <option key={`opt-${i}-${String(opt)}`} value={String(i)}>
            {String(opt)}
          </option>
        ))}
      </select>
    );
  } else if (kind === "secret") {
    control = (
      <input
        type="password"
        className={fieldCls}
        disabled={busy}
        placeholder={isSet ? "•••• set" : ""}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitText}
        onKeyDown={onKey}
      />
    );
  } else if (kind === "number" || kind === "integer") {
    control = (
      <input
        type="number"
        className={`${fieldCls} text-right`}
        disabled={busy}
        step={kind === "integer" ? 1 : "any"}
        min={typeof schema.minimum === "number" ? schema.minimum : undefined}
        max={typeof schema.maximum === "number" ? schema.maximum : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitText}
        onKeyDown={onKey}
      />
    );
  } else if (kind === "string") {
    control = (
      <input
        type="text"
        className={fieldCls}
        disabled={busy}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitText}
        onKeyDown={onKey}
      />
    );
  } else {
    control = <span className={labelCls}>unsupported schema</span>;
  }

  // "default" marker only when nothing is stored (secrets show "•••• set"
  // instead, never a default). "reset" appears only once a value is set.
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate" title={settingKey}>
          {prop.title}
        </span>
        <span className="flex flex-none items-center gap-1.5">
          {!isSet && kind !== "secret" && <span className={labelCls}>default</span>}
          <span className={labelCls}>{prop.scope}</span>
        </span>
      </div>
      {prop.description !== undefined && (
        <div className={`pl-2 ${labelCls}`}>{prop.description}</div>
      )}
      <div className="flex items-center gap-1.5 pl-2">
        {control}
        {isSet && (
          <button
            type="button"
            onClick={() => void reset()}
            disabled={busy}
            className={`flex-none ${labelCls} hover:text-neutral-600 dark:hover:text-neutral-300`}
          >
            reset
          </button>
        )}
      </div>
      {error !== null && (
        <div className={`truncate pl-2 text-right ${labelCls}`} title={error}>
          {error}
        </div>
      )}
    </div>
  );
}

export function PluginSettingsForm({
  pluginId,
  properties,
}: {
  pluginId: string;
  properties: SettingsContribution["properties"];
}): ReactElement {
  const entries = Object.entries(properties);
  return (
    <div className="mt-1.5 space-y-1.5 border-l border-neutral-100 pl-2 dark:border-neutral-700">
      {entries.length === 0 ? (
        <div className={labelCls}>no settings</div>
      ) : (
        entries.map(([k, prop]) => (
          <SettingRow key={k} pluginId={pluginId} settingKey={k} prop={prop} />
        ))
      )}
    </div>
  );
}
