import type { SettingsContribution } from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useEffect, useState } from "react";
import {
  buttonCls,
  fieldCls,
  labelCls,
  SettingsPill,
  SettingsRow,
  SettingsSwitch,
} from "./settings-ui";

// Generated plugin preferences. The controls come entirely from the plugin's
// declared schema; plugin code never mounts inside the settings surface.

interface SchemaView {
  type?: unknown;
  enum?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  default?: unknown;
}

interface SettingsValue {
  value?: unknown;
  isSet: boolean;
  secret?: boolean;
}

type ControlKind = "secret" | "enum" | "string" | "integer" | "number" | "boolean" | "unsupported";

function controlKind(scope: string, schema: SchemaView): ControlKind {
  if (scope === "secret") return "secret";
  if (Array.isArray(schema.enum)) return "enum";
  if (schema.type === "string") return "string";
  if (schema.type === "integer") return "integer";
  if (schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  return "unsupported";
}

function PluginSettingRow({
  pluginId,
  settingKey,
  prop,
  externalReload,
  onSettingsChanged,
}: {
  pluginId: string;
  settingKey: string;
  prop: SettingsContribution["properties"][string];
  externalReload: number;
  onSettingsChanged?: ((undoable: boolean) => void) | undefined;
}): ReactElement {
  const client = useFielddClient();
  const schema = prop.schema as SchemaView;
  const kind = controlKind(prop.scope, schema);
  const options = Array.isArray(schema.enum) ? schema.enum : [];
  const [loaded, setLoaded] = useState(false);
  const [isSet, setIsSet] = useState(false);
  const [value, setValue] = useState<unknown>(undefined);
  const [draft, setDraft] = useState("");
  const [boolDraft, setBoolDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void (async () => {
      try {
        const result = (await client.request("storage.settings.get", {
          pluginId,
          key: settingKey,
        })) as SettingsValue;
        if (cancelled) return;
        setError(null);
        setIsSet(result.isSet);
        setValue(result.isSet ? result.value : undefined);
        const current = result.isSet ? result.value : schema.default;
        if (prop.scope === "secret") {
          setDraft("");
        } else if (kind === "boolean") {
          setBoolDraft(current === true);
        } else if (kind === "enum") {
          const index = options.findIndex((option) => String(option) === String(current));
          setDraft(index >= 0 ? String(index) : "");
        } else {
          setDraft(current === undefined || current === null ? "" : String(current));
        }
        setLoaded(true);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
          setLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, pluginId, settingKey, prop, kind, reloadNonce, externalReload, schema.default]);

  const commit = async (nextValue: unknown): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await client.request("storage.settings.set", {
        pluginId,
        key: settingKey,
        value: nextValue,
      });
      onSettingsChanged?.(prop.scope === "user");
      setReloadNonce((nonce) => nonce + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const reset = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await client.request("storage.settings.reset", { pluginId, key: settingKey });
      onSettingsChanged?.(prop.scope === "user");
      setReloadNonce((nonce) => nonce + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const commitText = (): void => {
    if (prop.scope === "secret") {
      if (draft.length > 0) void commit(draft);
      return;
    }
    const baseline = isSet ? value : schema.default;
    const baselineString = baseline === undefined || baseline === null ? "" : String(baseline);
    if (draft === baselineString) return;
    if (kind === "number" || kind === "integer") {
      if (draft.trim() === "") return;
      const number = Number(draft);
      if (!Number.isNaN(number)) void commit(number);
      return;
    }
    void commit(draft);
  };

  let control: ReactElement;
  if (kind === "boolean") {
    control = (
      <SettingsSwitch
        label={prop.title}
        checked={boolDraft}
        disabled={!loaded || busy}
        onChange={(checked) => {
          setBoolDraft(checked);
          void commit(checked);
        }}
      />
    );
  } else if (kind === "enum") {
    control = (
      <select
        className={`${fieldCls} w-56`}
        disabled={!loaded || busy}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          const index = Number(event.target.value);
          if (index >= 0) void commit(options[index]);
        }}
      >
        {draft === "" && <option value="">Choose…</option>}
        {options.map((option, index) => (
          <option key={`${String(option)}-${index}`} value={String(index)}>
            {String(option)}
          </option>
        ))}
      </select>
    );
  } else if (kind === "unsupported") {
    control = <span className={labelCls}>Unsupported schema</span>;
  } else {
    control = (
      <input
        type={
          kind === "secret"
            ? "password"
            : kind === "number" || kind === "integer"
              ? "number"
              : "text"
        }
        className={`${fieldCls} w-56 ${kind === "number" || kind === "integer" ? "text-right tabular-nums" : ""}`}
        disabled={!loaded || busy}
        step={kind === "integer" ? 1 : kind === "number" ? "any" : undefined}
        min={typeof schema.minimum === "number" ? schema.minimum : undefined}
        max={typeof schema.maximum === "number" ? schema.maximum : undefined}
        placeholder={kind === "secret" && isSet ? "•••• set" : undefined}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitText}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitText();
        }}
      />
    );
  }

  return (
    <SettingsRow
      align="start"
      title={
        <span className="flex flex-wrap items-center gap-1.5" title={settingKey}>
          <span>{prop.title}</span>
          <SettingsPill>{prop.scope}</SettingsPill>
          {!isSet && kind !== "secret" && <SettingsPill>default</SettingsPill>}
        </span>
      }
      description={
        <>
          {prop.description !== undefined && <span>{prop.description}</span>}
          {error !== null && (
            <span className="mt-1 block text-amber-600 dark:text-amber-400" title={error}>
              {error}
            </span>
          )}
        </>
      }
    >
      <div className="flex items-center gap-2 pt-0.5">
        {control}
        {isSet && (
          <button
            type="button"
            className={`${buttonCls} h-8 px-3`}
            disabled={busy}
            onClick={() => void reset()}
          >
            Reset
          </button>
        )}
      </div>
    </SettingsRow>
  );
}

export function PluginSettingsForm({
  pluginId,
  properties,
  externalReload = 0,
  onSettingsChanged,
}: {
  pluginId: string;
  properties: SettingsContribution["properties"];
  externalReload?: number;
  onSettingsChanged?: ((undoable: boolean) => void) | undefined;
}): ReactElement {
  const entries = Object.entries(properties);
  const hasUserScope = entries.some(([, property]) => property.scope === "user");
  return (
    <div className="mt-3 rounded-[14px] bg-black/[0.025] px-3 dark:bg-white/[0.035]">
      {entries.length === 0 ? (
        <div className={`py-3 ${labelCls}`}>This plugin has no settings.</div>
      ) : (
        <>
          {entries.map(([key, property]) => (
            <PluginSettingRow
              key={key}
              pluginId={pluginId}
              settingKey={key}
              prop={property}
              externalReload={externalReload}
              onSettingsChanged={onSettingsChanged}
            />
          ))}
          <p className={`py-3 ${labelCls}`}>
            {hasUserScope
              ? "Synced user settings can be undone from the window toolbar."
              : "Device and secret settings stay on this device and are not part of settings history."}
          </p>
        </>
      )}
    </div>
  );
}
