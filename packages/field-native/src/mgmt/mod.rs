//! Management-channel server (design-02 §2.7): newline JSON-RPC over UDS,
//! hello-gated (D8), single authenticated client (new hello ⇒ SUPERSEDED),
//! snapshot-then-delta subscriptions (P5). Serves the M2 lifecycle surface +
//! the C2 mesh facade (mesh.rs); mesh calls answer UNAVAILABLE with the unit's
//! real state until the node is up.
//!
//! Since NF-5 `desired.set` carries real authority over the terminal floor: it
//! retains and prunes live sessions (native-floor spec §5). The three NF-D2
//! safety laws are what make that safe rather than merely powerful — silence
//! kills nothing, a prune needs proof the client saw THIS boot's inventory, and
//! generations only move forward. Interactive ops still never ride this channel.
//!
//! A fourth gate is the single-client rule itself, enforced per request rather
//! than at hello: a superseded connection's reader survives its supersession, and
//! none of the three laws above can fence it — a stale client may hold a HIGHER
//! generation than the fieldd that replaced it, and prove the same bootId.

mod diagnostics;
mod mesh;

use crate::contracts::{DesiredState, Hello};
use crate::pairing;
use crate::services::terminal;
use crate::services::terminal_client::ControlClient;
use crate::state::{ClientHandle, DaemonState, MgmtOutbox, OutMsg, MGMT_MAX_FRAME_BYTES};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

const CONTRACTS_VERSION: &str = "0.1.0";

/// How a reconcile prune classifies the exits it causes. `TerminationSource` is
/// a kebab-case wire enum with exactly three variants (session.rs:39-46) and
/// `classify_exit` maps this one to `ExitOutcome::ApplicationTerminated`
/// (session.rs:69-83), which is what every observer of the prune will read.
///
/// The choice among the three, recorded because it is a judgement:
/// * `user` — a human's kill, which is what `terminal.terminate` will carry
///   (NF-D5). A reconcile is not a human act; claiming it were would put a
///   person behind a decision fieldd's bookkeeping made.
/// * `service-shutdown` — reserved for the shutdown drain (G7's
///   `ServiceHandle::shutdown` stamps it upstream since NF-7), and it asserts
///   field-native is going down. Here it would be a lie: the floor keeps
///   serving, and the survivors keep running.
/// * `application` — the application above this floor (fieldd) withdrew the
///   session from its desired set. That is exactly what happened, so this is the
///   honest stamp.
const PRUNE_SOURCE: &str = "application";

/// Upstream's message for a `terminate` naming a session its registry does not
/// hold: `bail!("unknown session")` in `Command::Terminate`
/// (service.rs:1325-1343), reaching us through `{type:"error", message}` built
/// from `error.to_string()` (service.rs:1375-1380). It is the ONE failure that
/// means the session is already gone — everything else is a failure to reach the
/// plane, which says nothing about whether the ladder ran.
const UNKNOWN_SESSION: &str = "unknown session";

/// What a failed prune terminate actually tells us.
#[derive(Debug, PartialEq, Eq)]
enum PruneErrorKind {
    /// The floor no longer holds that session, so the desired end state (it is
    /// not running) already holds. fieldd's view merely lagged.
    AlreadyGone,
    /// A timeout, a closed connection, a refused write: the ladder may never
    /// have started and this daemon cannot say the session was pruned.
    Failed,
}

/// Classified from the message rather than a type because the wire carries only
/// a string: upstream answers `{type:"error", message}` and there is no code to
/// match on (service.rs:349-351).
fn classify_prune_error(message: &str) -> PruneErrorKind {
    // Two upstream refusal strings, one meaning: `terminate` answers
    // "unknown session", `set-persistence` answers "unknown or remote session"
    // (service.rs SetPersistence handler) — both say the registry row is gone.
    if message.contains(UNKNOWN_SESSION) || message.contains("unknown or remote session") {
        PruneErrorKind::AlreadyGone
    } else {
        PruneErrorKind::Failed
    }
}

pub async fn serve(listener: UnixListener, state: Arc<DaemonState>) {
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let state = state.clone();
                tokio::spawn(async move { handle_conn(stream, state).await });
            }
            Err(e) => {
                tracing::error!(
                    event = "field_native.mgmt.accept_failed",
                    component = "mgmt",
                    error = %e,
                    "The native management listener stopped accepting connections"
                );
                break;
            }
        }
    }
}

async fn handle_conn(stream: UnixStream, state: Arc<DaemonState>) {
    let conn_id = state.conn_id();
    let (read_half, mut write_half) = stream.into_split();
    let (tx, mut rx, mut close_rx) = MgmtOutbox::channel();

    // single writer task; Close tears the socket down
    let writer_outbox = tx.clone();
    let writer = tokio::spawn(async move {
        loop {
            tokio::select! {
                changed = close_rx.changed() => {
                    if changed.is_err() || *close_rx.borrow() {
                        break;
                    }
                }
                msg = rx.recv() => {
                    let Some(msg) = msg else { break };
                    match &msg {
                        OutMsg::Line(line) => {
                            let result = async {
                                write_half.write_all(line.as_bytes()).await?;
                                write_half.write_all(b"\n").await
                            }
                            .await;
                            writer_outbox.release(&msg);
                            if result.is_err() {
                                break;
                            }
                        }
                        OutMsg::Close => break,
                    }
                }
            }
        }
        let _ = write_half.shutdown().await;
    });

    let mut reader = BufReader::new(read_half);
    let mut authed = false;

    loop {
        let mut raw = Vec::new();
        let read = (&mut reader)
            .take((MGMT_MAX_FRAME_BYTES + 2) as u64)
            .read_until(b'\n', &mut raw)
            .await;
        let Ok(bytes) = read else { break };
        if bytes == 0 {
            break;
        }
        if raw.last() != Some(&b'\n') || raw.len() - 1 > MGMT_MAX_FRAME_BYTES {
            tracing::warn!(
                event = "field_native.mgmt.frame_too_large",
                component = "mgmt",
                limit = MGMT_MAX_FRAME_BYTES,
                "The management client sent an oversized or unterminated frame"
            );
            break;
        }
        raw.pop();
        let Ok(line) = String::from_utf8(raw) else {
            break;
        };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(req) = serde_json::from_str::<Value>(&line) else {
            send(
                &tx,
                json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"parse error"}}),
            );
            continue;
        };
        let id = req.get("id").cloned();
        let method = req
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let params = req.get("params").cloned().unwrap_or(Value::Null);

        // The single-client rule is a per-REQUEST law, not a hello-time one.
        // Superseding a connection closes its WRITE half (handle_hello sends
        // `Close`), but its reader loop keeps running and keeps its `authed`
        // flag, so a stale fieldd could still reach every mutating surface. The
        // generation guard cannot stand in for this: a stale client may hold a
        // HIGHER generation than the successor and would then be admitted to
        // prune the successor's PTYs. A re-hello is exempt — that is this
        // connection asking to become current again, which the rule allows.
        if authed && method != "native.lifecycle.hello" && !state.is_current_client(conn_id).await {
            send(&tx, superseded(id));
            send_raw(&tx, OutMsg::Close);
            break;
        }

        match method.as_str() {
            "native.lifecycle.hello" => {
                let (resp, ok) = handle_hello(&state, conn_id, &tx, &params, id).await;
                send(&tx, resp);
                if ok {
                    authed = true;
                } else {
                    send_raw(&tx, OutMsg::Close);
                    break;
                }
            }
            _ if !authed => {
                send(
                    &tx,
                    err(
                        id,
                        "UNAUTHORIZED",
                        -32001,
                        "hello required first",
                        false,
                        None,
                    ),
                );
            }
            "native.lifecycle.health.subscribe" => {
                let sub_id = state.sub_id();
                let snapshot = serde_json::to_value(&*state.health_tx.borrow()).unwrap();
                send(&tx, ok(id, json!({"subId": sub_id, "snapshot": snapshot})));
                spawn_forwarder(
                    tx.clone(),
                    state.health_tx.subscribe(),
                    "native.lifecycle.health.delta",
                    sub_id,
                );
            }
            "native.lifecycle.observed.subscribe" => {
                let sub_id = state.sub_id();
                let snapshot = serde_json::to_value(&*state.observed_tx.borrow()).unwrap();
                send(&tx, ok(id, json!({"subId": sub_id, "snapshot": snapshot})));
                spawn_forwarder(
                    tx.clone(),
                    state.observed_tx.subscribe(),
                    "native.lifecycle.observed.delta",
                    sub_id,
                );
            }
            "native.lifecycle.desired.set" => {
                send(&tx, handle_desired_set(&state, conn_id, &params, id).await);
            }
            "native.diagnostics.query" => {
                send(&tx, diagnostics::query(&state, &params, id));
            }
            "native.diagnostics.subscribe" => {
                diagnostics::subscribe(&state, &tx, &params, id);
            }
            "native.diagnostics.lease.create" => {
                send(&tx, diagnostics::lease_create(&state, &params, id));
            }
            "native.diagnostics.lease.list" => {
                send(&tx, diagnostics::lease_list(&state, id));
            }
            "native.diagnostics.lease.revoke" => {
                send(&tx, diagnostics::lease_revoke(&state, &params, id));
            }
            m if m.starts_with("native.mesh.") => {
                mesh::handle(&state, &tx, m, &params, id).await;
            }
            m if m.starts_with("native.process.") || m.starts_with("native.sidecar.") => {
                send(
                    &tx,
                    err(
                        id,
                        "UNAVAILABLE",
                        -32006,
                        "unit not embedded yet",
                        true,
                        Some(
                            json!({"service": m.split('.').nth(1).unwrap_or("native"), "state":"stub"}),
                        ),
                    ),
                );
            }
            _ => {
                send(
                    &tx,
                    err(id, "NOT_FOUND", -32601, "method not found", false, None),
                );
            }
        }
    }

    // cleanup: release the single-client slot if it is still ours
    let mut cur = state.current_client.lock().await;
    if cur.as_ref().is_some_and(|c| c.conn_id == conn_id) {
        *cur = None;
    }
    drop(cur);
    send_raw(&tx, OutMsg::Close);
    let _ = writer.await;
}

async fn handle_hello(
    state: &Arc<DaemonState>,
    conn_id: u64,
    tx: &MgmtOutbox,
    params: &Value,
    id: Option<Value>,
) -> (Value, bool) {
    // shape-validate through the contracts type (tolerant reader — P3)
    let hello: Hello = match serde_json::from_value(params.clone()) {
        Ok(h) => h,
        Err(e) => {
            return (
                err(
                    id,
                    "PRECONDITION_FAILED",
                    -32005,
                    &format!("bad hello: {e}"),
                    false,
                    None,
                ),
                false,
            )
        }
    };

    // version gate: major must match (0.x line — tolerant within it, P3)
    let ours_major = CONTRACTS_VERSION.split('.').next().unwrap_or("0");
    let theirs = hello.contracts_version.to_string();
    if theirs.split('.').next().unwrap_or("") != ours_major {
        return (
            err(
                id,
                "INCOMPATIBLE",
                -32009,
                "contracts major mismatch",
                false,
                Some(json!({"server": CONTRACTS_VERSION, "client": theirs})),
            ),
            false,
        );
    }

    // D8 pairing credential (read from raw params — variant-name independent)
    let cred = params.get("credential");
    let (Some(boot_id), Some(ts), Some(mac)) = (
        cred.and_then(|c| c.get("bootId")).and_then(Value::as_str),
        cred.and_then(|c| c.get("ts")).and_then(Value::as_i64),
        cred.and_then(|c| c.get("mac")).and_then(Value::as_str),
    ) else {
        return (
            err(
                id,
                "UNAUTHORIZED",
                -32001,
                "pairing credential required",
                false,
                None,
            ),
            false,
        );
    };
    if !pairing::verify(&state.secret, boot_id, ts, mac, pairing::now_epoch_secs()) {
        return (
            err(
                id,
                "UNAUTHORIZED",
                -32001,
                "pairing verification failed",
                false,
                None,
            ),
            false,
        );
    }

    // single-client rule: supersede any existing product plane
    let mut cur = state.current_client.lock().await;
    if let Some(old) = cur.take() {
        let _ = old.tx.send(OutMsg::Line(
            json!({"jsonrpc":"2.0","method":"native.lifecycle.superseded","params":{"reason":"new hello"}})
                .to_string(),
        ));
        let _ = old.tx.send(OutMsg::Close);
        tracing::info!(
            event = "field_native.mgmt.client_superseded",
            component = "mgmt",
            previous_connection = old.conn_id,
            new_connection = conn_id,
            "A newer fieldd management client superseded the previous connection"
        );
    }
    *cur = Some(ClientHandle {
        conn_id,
        tx: tx.clone(),
    });
    tracing::info!(
        event = "field_native.mgmt.client_authenticated",
        component = "mgmt",
        connection = conn_id,
        "fieldd authenticated to the native management channel"
    );

    let mut ack = json!({
        "contractsVersion": CONTRACTS_VERSION,
        "serverKind": "field-native",
        "grantedScopes": [],
        "nativeBuild": native_build(),
    });
    // NF-D8: the terminal floor's endpoints ride the hello, so fieldd re-learns
    // them at every re-pair and they never enter env, config, or logs. Field
    // names come from the generated contract type, never retyped here. Absent
    // when no terminal unit is configured — tolerated by readers.
    if let Some(endpoints) = state.terminal.get() {
        ack["terminal"] = serde_json::to_value(endpoints).expect("terminal endpoints serialize");
    }
    (ok(id, ack), true)
}

/// GT-2d — who is actually answering this socket. This plane outlives fieldd
/// and is adopted by design, so the floor a shell pairs with can be many builds
/// older than the tree that started the pairing; a July native answering an
/// August fieldd reports its missing units perfectly honestly and reads as a
/// product bug. The crate version is always available; `FIELDD_BUILD_ID` is the
/// development snapshot identity, inherited from the fieldd that spawned this
/// process (bin.ts hands its whole environment down) — present in dev, absent
/// in a packaged run, which is why it is a suffix and not a requirement. A
/// build label, never a secret and never parsed for behavior.
fn native_build() -> String {
    const BASE: &str = concat!("field-native/", env!("CARGO_PKG_VERSION"));
    match std::env::var("FIELDD_BUILD_ID") {
        Ok(stamp) if !stamp.is_empty() => format!("{BASE}+{stamp}"),
        _ => BASE.to_string(),
    }
}

async fn handle_desired_set(
    state: &Arc<DaemonState>,
    conn_id: u64,
    params: &Value,
    id: Option<Value>,
) -> Value {
    let desired: DesiredState = match serde_json::from_value(params.clone()) {
        Ok(d) => d,
        Err(e) => {
            return err(
                id,
                "PRECONDITION_FAILED",
                -32005,
                &format!("bad desired state: {e}"),
                false,
                None,
            )
        }
    };
    // Held across the whole reconcile: two sets must never interleave their
    // prunes, and a refused set must leave nothing of itself behind.
    let mut slot = state.desired.lock().await;
    // Asked again HERE, adjacent to the effect and under the reconcile lock. The
    // dispatch gate in `handle_conn` only knows the truth as of the moment the
    // request was read, and this set may have waited behind another one's prune
    // while a hello superseded its connection. Lock order is desired →
    // current_client and nothing takes them the other way round.
    if !state.is_current_client(conn_id).await {
        return superseded(id);
    }
    if let Some(cur) = slot.as_ref() {
        if desired.generation < cur.generation {
            return err(
                id,
                "PRECONDITION_FAILED",
                -32005,
                "stale generation",
                false,
                Some(json!({"current": cur.generation, "given": desired.generation})),
            );
        }
    }

    // NF-D2: the survivor set IS the authority — what fieldd lists it keeps,
    // what it omits runs its ladder. Measured against the inventory the terminal
    // unit publishes, whose truth is `list-sessions` (spec §10.5). Owned ids
    // because a watch borrow cannot cross an await.
    let prune: Vec<String> = {
        let listed: HashSet<&str> = desired
            .terminals
            .iter()
            .map(|terminal| terminal.session_id.as_str())
            .collect();
        let observed = state.observed_tx.borrow();
        observed
            .terminals
            .iter()
            .map(|terminal| terminal.session_id.as_str())
            .filter(|session_id| !listed.contains(session_id))
            .map(str::to_owned)
            .collect()
    };

    // Desired NEVER creates: creation is interactive and rides ghosttea's own
    // control socket (NF-D2, design-02 §2.7's no-interactive-ops law). A session
    // this set lists that the floor does not have is fieldd's view lagging, not
    // an instruction — it is retained by saying nothing about it.
    //
    // Persistence re-policy is REAL since NF-7 (ghosttea 0.7.0, the G9
    // landing): `set-persistence` writes under the service's registry lock and
    // answers with the applied summary, and `SessionSummary.persistence` fills
    // the observed inventory this diff is computed against. Only sessions the
    // floor OBSERVES are re-policied — a desired row the inventory lacks is
    // fieldd's view lagging (same law as creation above), and a `None` in
    // observed is unknown, so a stated desire applies.
    let repolicy: Vec<(String, String)> = {
        let observed = state.observed_tx.borrow();
        desired
            .terminals
            .iter()
            .filter_map(|terminal| {
                let want = terminal.persistence.as_ref()?;
                let row = observed
                    .terminals
                    .iter()
                    .find(|row| row.session_id == terminal.session_id)?;
                (row.persistence.as_deref() != Some(want.as_str()))
                    .then(|| (terminal.session_id.clone(), want.clone()))
            })
            .collect()
    };

    if !prune.is_empty() {
        // NF-D2(b): a fieldd may only kill what it has SEEN this boot. An absent
        // proof and a stale one are the same refusal — either way the client is
        // pruning against an inventory that is not this daemon's.
        if desired.observed_boot_id.as_deref() != Some(state.boot_id.as_str()) {
            return err(
                id,
                "PRECONDITION_FAILED",
                -32005,
                "observedBootId must match this boot before a desired set may prune (NF-D2)",
                false,
                Some(json!({
                    "current": state.boot_id,
                    "given": desired.observed_boot_id,
                    "wouldPrune": prune.len(),
                })),
            );
        }
    }

    // One plane connection for every effect this set carries (re-policy and
    // prune). NF-6's dial-before-store law covers both: a plane that cannot be
    // reached refuses the WHOLE set rather than banking a generation whose
    // effects never ran, and without endpoints there is no plane to execute on
    // — never a success that did nothing. (Inventory would normally be empty in
    // that state; the guard states the law regardless.)
    //
    // The event receiver rides in `plane` for the whole reconcile on purpose.
    // Every control connection receives every broadcast event
    // (service.rs:470/624), so the first `session-exited` a prune causes comes
    // back on this very connection; a receiver dropped early would make it
    // undeliverable while the prune is still issuing terminates. The client
    // discards undeliverable events rather than ending its read loop, so this
    // is the second of two independent reasons the reconcile cannot wedge
    // itself.
    let plane = if !prune.is_empty() || !repolicy.is_empty() {
        let Some(endpoints) = state.terminal.get() else {
            return err(
                id,
                "UNAVAILABLE",
                -32006,
                "the terminal plane has no endpoints, so the desired set's effects cannot be executed",
                true,
                Some(json!({
                    "service": terminal::UNIT_ID,
                    "state": terminal_state(state),
                    "wouldPrune": prune.len(),
                    "wouldRepolicy": repolicy.len(),
                })),
            );
        };
        match ControlClient::connect(Path::new(&endpoints.control_socket), &endpoints.auth_token)
            .await
        {
            Ok(pair) => Some(pair),
            Err(error) => {
                tracing::warn!(
                    event = "field_native.lifecycle.plane_unreachable",
                    component = "mgmt",
                    generation = desired.generation,
                    error = %error,
                    "The terminal control plane could not be reached; the desired set was refused"
                );
                return err(
                    id,
                    "UNAVAILABLE",
                    -32006,
                    "the terminal control plane could not be reached, so the desired set was not applied",
                    true,
                    Some(json!({
                        "service": terminal::UNIT_ID,
                        "state": terminal_state(state),
                        "wouldPrune": prune.len(),
                        "wouldRepolicy": repolicy.len(),
                    })),
                );
            }
        }
    } else {
        None
    };

    // Spec §5's order: re-policy BEFORE the prune — a session promoted and
    // withdrawn by the same set still gets its retention decided by the new
    // policy when its ladder concludes.
    if !repolicy.is_empty() {
        let (client, _events) = plane.as_ref().expect("plane is connected when work exists");
        tracing::info!(
            event = "field_native.lifecycle.repolicy_attempt",
            component = "mgmt",
            generation = desired.generation,
            sessions = repolicy.len(),
            "The desired set changes session persistence; applying it"
        );
        let mut failed_repolicy: Vec<&str> = Vec::new();
        for (session_id, persistence) in &repolicy {
            match client.set_persistence(session_id, persistence).await {
                Ok(()) => {}
                Err(error) => match classify_prune_error(&format!("{error:#}")) {
                    // The observed row was stale: the session concluded between
                    // fieldd's snapshot and this call. Its policy is moot — the
                    // ordinary race, not a failure.
                    PruneErrorKind::AlreadyGone => tracing::debug!(
                        event = "field_native.lifecycle.repolicy_skipped",
                        component = "mgmt",
                        session_id = %session_id,
                        error = %error,
                        "A re-policied session was already gone from the terminal registry"
                    ),
                    // Same law as the prune below: a set whose effects half-ran
                    // is NOT applied — nothing banked, and `set-persistence` is
                    // idempotent, so retrying this same generation is safe.
                    PruneErrorKind::Failed => {
                        failed_repolicy.push(session_id);
                        tracing::warn!(
                            event = "field_native.lifecycle.repolicy_failed",
                            component = "mgmt",
                            generation = desired.generation,
                            session_id = %session_id,
                            error = %error,
                            "A session's persistence change could not be applied; the desired set was refused"
                        );
                    }
                },
            }
        }
        if !failed_repolicy.is_empty() {
            return err(
                id,
                "UNAVAILABLE",
                -32006,
                "some persistence changes could not be applied, so the desired set was not applied",
                true,
                Some(json!({
                    "service": terminal::UNIT_ID,
                    "state": terminal_state(state),
                    "generation": desired.generation,
                    "failedRepolicy": failed_repolicy,
                })),
            );
        }
    }

    if !prune.is_empty() {
        let (client, _events) = plane.as_ref().expect("plane is connected when work exists");

        // Attempt-before-effect (spec §8): the intent is on the record before a
        // single ladder fires, so a prune is accountable even if this daemon dies
        // mid-reconcile. The durable audit record is the LOG-L6 writer's job,
        // above this seam.
        tracing::info!(
            event = "field_native.lifecycle.prune_attempt",
            component = "mgmt",
            generation = desired.generation,
            sessions = %prune.join(","),
            source = PRUNE_SOURCE,
            "The desired set withdrew terminal sessions; terminating them"
        );
        // Per-session outcomes, because `{applied}` may only be said of a prune
        // that actually happened. `pruned` counts the sessions whose desired end
        // state now holds (terminated, or already gone); `failed` names the ones
        // this daemon cannot vouch for.
        let mut pruned = 0_usize;
        let mut failed: Vec<&str> = Vec::new();
        for session_id in &prune {
            // Fire the ladder and move on. Upstream's `terminate` starts it on
            // its own thread and returns (session.rs:1558-1584), so the ladders
            // overlap and this response never waits on an exit — the inventory
            // pump is what reports convergence.
            match client.terminate(session_id, PRUNE_SOURCE).await {
                Ok(()) => pruned += 1,
                Err(error) => match classify_prune_error(&format!("{error:#}")) {
                    // The ordinary race between fieldd's view and this floor's:
                    // the desired end state already holds, so it is debug and it
                    // counts toward the prune.
                    PruneErrorKind::AlreadyGone => {
                        pruned += 1;
                        tracing::debug!(
                            event = "field_native.lifecycle.prune_terminate_skipped",
                            component = "mgmt",
                            session_id = %session_id,
                            error = %error,
                            "A pruned session was already gone from the terminal registry"
                        );
                    }
                    // A timeout or a torn connection says NOTHING about whether
                    // the ladder started. Swallowing these is what let `{applied}`
                    // lie about a prune that half-ran.
                    PruneErrorKind::Failed => {
                        failed.push(session_id);
                        tracing::warn!(
                            event = "field_native.lifecycle.prune_terminate_failed",
                            component = "mgmt",
                            generation = desired.generation,
                            session_id = %session_id,
                            error = %error,
                            "A pruned session's termination could not be confirmed; the desired set was refused"
                        );
                    }
                },
            }
        }
        // A set whose prune half-ran is NOT applied: nothing is stored and no
        // generation is banked, so fieldd retries the SAME generation and the
        // monotonicity guard admits it precisely because we stored nothing.
        if !failed.is_empty() {
            return err(
                id,
                "UNAVAILABLE",
                -32006,
                "some withdrawn terminal sessions could not be terminated, so the desired set was not applied",
                true,
                Some(json!({
                    "service": terminal::UNIT_ID,
                    "state": terminal_state(state),
                    "generation": desired.generation,
                    "pruned": pruned,
                    "failed": failed,
                })),
            );
        }
    }

    let generation = desired.generation;
    // What fieldd LISTED, which is not the same as what was retained: a listed
    // session this floor never had is not a survivor, just a stale row.
    let listed = desired.terminals.len();
    // Inert by spec §5 until a native worker exists, and by NF-D2 for the mesh:
    // tolerated on the wire, logged so a fieldd sending them is not left
    // believing they took effect.
    if !desired.workers.is_empty() || desired.mesh_config.is_some() {
        tracing::debug!(
            event = "field_native.lifecycle.desired_inert_fields",
            component = "mgmt",
            generation,
            workers = desired.workers.len(),
            mesh_config = desired.mesh_config.is_some(),
            "The desired set carried fields this floor does not act on yet"
        );
    }
    // Both under the reconcile lock, and in this order: storing first means a
    // published generation is always one this daemon has banked, and publishing
    // before the lock is released means two concurrent sets cannot hand
    // subscribers their generations out of order (the watch channel would then
    // report a moving-backwards generation the guard forbids).
    *slot = Some(desired);
    state.observed_tx.send_modify(|o| o.generation = generation);
    drop(slot);
    tracing::info!(
        event = "field_native.lifecycle.desired_applied",
        component = "mgmt",
        generation,
        listed,
        pruned = prune.len(),
        repolicied = repolicy.len(),
        "The desired native state generation was applied"
    );
    ok(id, json!({"applied": generation}))
}

/// The terminal unit's REAL state for an `UNAVAILABLE` detail — the same law the
/// mesh facade follows (C1: details carry the unit's state, never a literal).
/// Read from the health the unit itself publishes; `null` only if the unit was
/// never registered at all.
fn terminal_state(state: &DaemonState) -> Value {
    state
        .health_tx
        .borrow()
        .units
        .iter()
        .find(|unit| unit.unit == terminal::UNIT_ID)
        .map_or(Value::Null, |unit| json!(unit.state.to_string()))
}

fn spawn_forwarder<T>(
    tx: MgmtOutbox,
    mut rx: tokio::sync::watch::Receiver<T>,
    method: &'static str,
    sub_id: String,
) where
    T: serde::Serialize + Clone + Send + Sync + 'static,
{
    tokio::spawn(async move {
        while rx.changed().await.is_ok() {
            let payload = serde_json::to_value(&*rx.borrow()).unwrap();
            let note = json!({"jsonrpc":"2.0","method": method, "params": {"subId": sub_id, "payload": payload}});
            if tx.send(OutMsg::Line(note.to_string())).is_err() {
                break;
            }
        }
    });
}

/// What a superseded connection's requests get. The `superseded` notification
/// already told that client why its plane ended; this is the honest answer to
/// anything it asks afterwards, and refusing rather than serving is what keeps a
/// stale fieldd from pruning its successor's sessions.
fn superseded(id: Option<Value>) -> Value {
    err(
        id,
        "UNAUTHORIZED",
        -32001,
        "this connection was superseded by a newer management client",
        false,
        None,
    )
}

fn send(tx: &MgmtOutbox, v: Value) {
    let _ = tx.send(OutMsg::Line(v.to_string()));
}
fn send_raw(tx: &MgmtOutbox, m: OutMsg) {
    let _ = tx.send(m);
}
fn ok(id: Option<Value>, result: Value) -> Value {
    json!({"jsonrpc":"2.0","id": id.unwrap_or(Value::Null), "result": result})
}
fn err(
    id: Option<Value>,
    kind: &str,
    code: i64,
    message: &str,
    retryable: bool,
    details: Option<Value>,
) -> Value {
    let mut data = json!({"kind": kind, "retryable": retryable});
    if let Some(d) = details {
        data["details"] = d;
    }
    json!({"jsonrpc":"2.0","id": id.unwrap_or(Value::Null), "error": {"code": code, "message": message, "data": data}})
}

/// The prune classifier gets unit tests rather than an e2e case for an honest
/// reason: a real terminate failure cannot be forced against a live floor
/// without wedging the service, and every string below is one this exact client
/// produces (`terminal_client.rs`) or one upstream produces
/// (`service.rs:1325-1343`). The happy path stays covered end to end.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unknown_session_is_the_ordinary_race() {
        assert_eq!(
            classify_prune_error("terminal control error: unknown session"),
            PruneErrorKind::AlreadyGone
        );
    }

    #[test]
    fn unreachability_is_a_real_prune_failure() {
        for message in [
            // the client's own three, verbatim
            "terminal control request timed out",
            "terminal control connection closed before answering",
            "write control request: Broken pipe (os error 32)",
            // an upstream refusal that is NOT already-gone
            "terminal control error: session owner is already closed",
        ] {
            assert_eq!(
                classify_prune_error(message),
                PruneErrorKind::Failed,
                "{message} must not be read as an already-exited session"
            );
        }
    }
}
