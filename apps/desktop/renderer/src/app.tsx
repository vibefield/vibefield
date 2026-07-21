import type { FielddHealth } from "@vibefield/fieldd";
import { useFielddStatus, useSubscription } from "@vibefield/fieldd-client/react";
import { useEffect, useRef, useState } from "react";

// Track A health page: the walking skeleton's first pixels. Live view of the
// whole spine — renderer ⇄ fieldd ⇄ field-native — via one subscription.

interface UnitRow {
  unit: string;
  state?: string;
  health?: string;
  detail?: string | null;
}

function pillClass(v: string | undefined): string {
  if (v === "running" || v === "ok" || v === "up") return "pill good";
  if (v === "degraded" || v === "starting" || v === "stub") return "pill warn";
  return "pill bad";
}

export function App() {
  const conn = useFielddStatus();
  const sub = useSubscription<FielddHealth>("system.health.subscribe");
  const h = sub.data;
  const units: UnitRow[] = (h?.native as { units?: UnitRow[] } | null)?.units ?? [];

  // transition ticker — makes the kill matrix visible
  const [log, setLog] = useState<Array<{ at: string; line: string; bad: boolean }>>([]);
  const prev = useRef<boolean | null>(null);
  useEffect(() => {
    if (!h) return;
    if (prev.current !== null && prev.current !== h.nativeConnected) {
      const bad = !h.nativeConnected;
      const line = bad ? "native plane lost — degraded" : "native plane reconnected";
      setLog((l) => [{ at: new Date().toLocaleTimeString(), line, bad }, ...l].slice(0, 8));
    }
    prev.current = h.nativeConnected;
  }, [h]);

  const overall =
    conn !== "ready"
      ? conn === "connecting" || conn === "reconnecting"
        ? { label: conn, cls: "warn" }
        : { label: conn, cls: "bad" }
      : h?.nativeConnected
        ? { label: "all systems", cls: "good" }
        : { label: "native down", cls: "bad" };

  return (
    <div className="frame">
      <header>
        <div className="brand">
          <span className="mark" />
          VibeField
          <span className="sub">walking skeleton</span>
        </div>
        <div className={`pill ${overall.cls}`}>{overall.label}</div>
      </header>

      <main>
        <section className="cards">
          <div className="card">
            <h2>fieldd · product plane</h2>
            {h ? (
              <dl>
                <dt>state</dt>
                <dd>
                  <span className={pillClass(h.fieldd.state)}>{h.fieldd.state}</span>
                </dd>
                <dt>boot</dt>
                <dd className="mono">{h.fieldd.bootId}</dd>
                <dt>contracts</dt>
                <dd className="mono">v{h.fieldd.contractsVersion}</dd>
                <dt>pid</dt>
                <dd className="mono">{h.fieldd.pid}</dd>
                <dt>started</dt>
                <dd className="mono">{new Date(h.fieldd.startedAt).toLocaleTimeString()}</dd>
              </dl>
            ) : (
              <p className="muted">{sub.status === "error" ? String(sub.error) : "connecting…"}</p>
            )}
          </div>

          <div className="card">
            <h2>field-native · OS plane</h2>
            {h ? (
              <dl>
                <dt>link</dt>
                <dd>
                  <span className={h.nativeConnected ? "pill good" : "pill bad"}>
                    {h.nativeConnected ? "connected" : "disconnected"}
                  </span>
                </dd>
                <dt>units</dt>
                <dd className="mono">{units.length}</dd>
              </dl>
            ) : (
              <p className="muted">—</p>
            )}
          </div>
        </section>

        <section className="card wide">
          <h2>native units</h2>
          {units.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>unit</th>
                  <th>state</th>
                  <th>detail</th>
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.unit}>
                    <td className="mono">{u.unit}</td>
                    <td>
                      <span className={pillClass(u.state ?? u.health)}>{u.state ?? u.health ?? "?"}</span>
                    </td>
                    <td className="muted">{u.detail ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">{h && !h.nativeConnected ? "native plane unreachable" : "no units reported"}</p>
          )}
        </section>

        {log.length > 0 && (
          <section className="card wide">
            <h2>transitions</h2>
            <ul className="ticker">
              {log.map((e, i) => (
                <li key={i} className={e.bad ? "bad" : "good"}>
                  <span className="mono muted">{e.at}</span> {e.line}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
