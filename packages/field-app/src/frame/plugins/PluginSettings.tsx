import type { SettingsGetResult } from "@vibefield/contracts";
import { UiSwitch, uiFieldClass } from "@vibefield/design-kit";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type PageSetting,
  type PageSettings,
  settingAct,
  settingDraft,
  settingToSend,
} from "./plugins-model";
import type { PluginsPort } from "./plugins-port";
import { REMOVE_WORDS, SETTINGS_WORDS } from "./plugins-words";

// A PLUGIN'S SETTINGS ON ITS PAGE (MK-4c2b; DESIGN.md §8 "Its settings", as corrected for James's
// MK-O6 pick): a Built in or Development plugin's settings, each a row with its own control, over
// the port's three requests — `storage.settings.get`, `.set` and `.reset`, the ones Settings →
// Plugins sends today, with the same parameters. MK-4c2c (James's click, 2026-11-14 08:19:36Z,
// "Yes, add them to the plugin's page"): a kept setting has Back to default, one press; a kept
// secret has Remove the saved secret…, which asks first, in place, in RemoveQuestion.tsx's pattern
// (MK-4f; §8 "The destructive uninstall affordance"): its consequence line, Cancel leading and
// holding the keyboard, Remove trailing in the danger ink, so one press is never irreversible. The
// page learns only whether a secret is kept, before and after. No Undo or Redo: undoing a synced
// change stays in Settings. Each row reads its setting as the page opens (or once fieldd answers,
// when it isn't answering then) and after its own change; nothing re-reads on its own (S1). A
// control takes no input while the plugin is off, while its request is out, or while fieldd isn't
// answering. A refusal is said in §9's words under the setting, never the error's own text; a
// secret typed and refused stays in its masked field, and fieldd never sends a window what is kept.
// A setting fieldd refuses to read says so under it in §9's words and takes no input (Unread): a
// failed read sets no `readFor`, so it is read again at the page's next opening or once fieldd
// answers after being away, and nothing retries it on its own. Settings → Plugins keeps its own
// form until MK-5.

interface RowProps {
  id: string;
  setting: PageSetting;
  port: PluginsPort;
  live: boolean;
  away: boolean;
}

function SettingRow({ id, setting: given, port, live, away }: RowProps): ReactElement {
  // The page is drawn afresh from each registry snapshot, so the setting arrives as a new object
  // each time; the row keeps one per declared shape, so a snapshot that changes nothing of it
  // never reads it again (S1).
  const shape = JSON.stringify(given);
  const setting = useMemo(() => JSON.parse(shape) as PageSetting, [shape]);
  const [got, setGot] = useState<SettingsGetResult | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const [unread, setUnread] = useState(false);
  const [reads, setReads] = useState(0);
  // MK-4c2c: the saved secret's removal, asked in place
  const [asking, setAsking] = useState(false);
  // a second press before React renders still sends nothing
  const busyRef = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  // the change whose read has landed (-1: none yet), so fieldd answering again after being away
  // reads nothing anew
  const readFor = useRef(-1);

  // the read: as the row opens, or once fieldd answers, and after its own change (never while it
  // is away)
  useEffect(() => {
    if (away || readFor.current === reads) return;
    let current = true;
    port.settingsGet(id, setting.key).then(
      (answer) => {
        if (!current) return;
        readFor.current = reads;
        setUnread(false);
        setGot(answer);
        setDraft(settingDraft(setting, answer));
      },
      () => {
        if (current) setUnread(true);
      },
    );
    return () => {
      current = false;
    };
  }, [port, id, setting, away, reads]);

  // one change at a time, a set or a way back: under way it takes no input, refused it says so, and
  // after it the row reads its setting again
  const change = useCallback(
    (request: () => Promise<void>) => {
      // nothing is sent while a read is refused, even over a value an earlier read showed (Unread)
      if (busyRef.current || !live || away || unread) return;
      busyRef.current = true;
      setBusy(true);
      setRefused(false);
      request()
        .then(
          () => setReads((n) => n + 1),
          () => setRefused(true),
        )
        .finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
    },
    [live, away, unread],
  );

  const send = useCallback(
    (value: unknown) => change(() => port.settingsSet(id, setting.key, value)),
    [change, port, id, setting.key],
  );

  // MK-4c2c: back to its default, or a kept secret deleted: fieldd's one door for both
  const reset = useCallback(() => {
    setAsking(false);
    change(() => port.settingsReset(id, setting.key));
  }, [change, port, id, setting.key]);

  // the question holds the keyboard on its Cancel as it stands (RemoveQuestion's pattern)
  useLayoutEffect(() => {
    if (asking) cancel.current?.focus({ preventScroll: true });
  }, [asking]);

  const sendDraft = useCallback(() => {
    if (got === null) return;
    const out = settingToSend(setting, draft, got);
    if (out !== null) send(out.value);
  }, [got, setting, draft, send]);

  // a refused read takes the control's input away, whatever an earlier read still shows (§8 Unread)
  const still = !live || away || busy || got === null || unread;
  const act = got === null ? null : settingAct(setting, got);
  let control: ReactElement;
  if (setting.kind === "switch") {
    control = (
      <UiSwitch
        checked={draft === "true"}
        disabled={still}
        label={setting.title}
        className="vf-plugins-switch"
        onChange={(on) => send(on)}
      />
    );
  } else if (setting.kind === "choice") {
    control = (
      <select
        className={uiFieldClass}
        aria-label={setting.title}
        disabled={still}
        value={draft}
        onChange={(event) => {
          const at = Number(event.target.value);
          // the menu shows the kept choice until fieldd's next answer says otherwise
          if (at >= 0 && at < setting.options.length) send(setting.options[at]);
        }}
      >
        {draft === "" && <option value="">{SETTINGS_WORDS.choose}</option>}
        {setting.options.map((option, at) => (
          <option key={`${String(option)}-${at}`} value={String(at)}>
            {String(option)}
          </option>
        ))}
      </select>
    );
  } else if (setting.kind === "unsupported") {
    control = <span className="vf-plugins-page-under">{SETTINGS_WORDS.cantDraw}</span>;
  } else {
    const numeric = setting.kind === "integer" || setting.kind === "number";
    const kept = setting.kind === "secret" && got?.isSet === true;
    control = (
      <input
        type={setting.kind === "secret" ? "password" : numeric ? "number" : "text"}
        className={uiFieldClass}
        aria-label={setting.title}
        disabled={still}
        spellCheck={false}
        autoComplete="off"
        step={setting.kind === "integer" ? 1 : setting.kind === "number" ? "any" : undefined}
        min={setting.min ?? undefined}
        max={setting.max ?? undefined}
        placeholder={kept ? SETTINGS_WORDS.saved : undefined}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={sendDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") sendDraft();
        }}
      />
    );
  }

  return (
    <li className="vf-plugins-setting">
      <span className="vf-plugins-setting-text">
        <span className="vf-plugins-setting-title">{setting.title}</span>
        {setting.description !== null && (
          <span className="vf-plugins-page-under">{setting.description}</span>
        )}
        {act !== null && !asking && (
          // in Remove…'s own frame, so the quiet button keeps its width (`.vf-plugins-remove`)
          <span className="vf-plugins-remove">
            <button
              type="button"
              className="vf-plugins-card-cancel"
              disabled={still}
              onClick={act === "forget" ? () => setAsking(true) : reset}
            >
              {act === "forget" ? SETTINGS_WORDS.forget : SETTINGS_WORDS.toDefault}
            </button>
          </span>
        )}
        {asking && (
          <span className="vf-plugins-remove" data-setting-ask>
            <span className="vf-plugins-card-line">{SETTINGS_WORDS.forgetLine}</span>
            <span className="vf-plugins-card-acts">
              <button
                ref={cancel}
                type="button"
                className="vf-plugins-card-cancel"
                onClick={() => setAsking(false)}
              >
                {REMOVE_WORDS.cancel}
              </button>
              <button
                type="button"
                className="vf-plugins-act"
                data-tone="danger"
                disabled={still}
                onClick={reset}
              >
                {REMOVE_WORDS.confirm}
              </button>
            </span>
          </span>
        )}
        {refused && <span className="vf-plugins-page-refused">{SETTINGS_WORDS.refused}</span>}
        {unread && <span className="vf-plugins-page-refused">{SETTINGS_WORDS.unread}</span>}
      </span>
      {control}
    </li>
  );
}

/** The section: its head, the off line, a row per setting, and the foot. The controller mounts it
 * once per page opening, so each opening reads every setting again. */
export function PluginSettings({
  id,
  settings,
  port,
  away,
}: {
  id: string;
  settings: PageSettings;
  port: PluginsPort;
  away: boolean;
}): ReactElement {
  return (
    <section className="vf-plugins-page-section vf-plugins-settings">
      <h3 className="vf-plugins-page-head">{SETTINGS_WORDS.head}</h3>
      {settings.offLine !== null && <p className="vf-plugins-page-note">{settings.offLine}</p>}
      <ul className="vf-plugins-settings-rows">
        {settings.rows.map((setting) => (
          <SettingRow
            key={setting.key}
            id={id}
            setting={setting}
            port={port}
            live={settings.live}
            away={away}
          />
        ))}
      </ul>
      <p className="vf-plugins-page-note vf-plugins-settings-foot">{settings.foot}</p>
    </section>
  );
}
