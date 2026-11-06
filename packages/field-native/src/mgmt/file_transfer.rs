//! DR-3a (W3, VF-FLOOR) — `native.mesh.fileTransfer.*`, the facade's file
//! transfer verbs (contracts mgmt.ts, the file transfer's header; the
//! substrate is `services/file_transfer.rs`).
//!
//! Answered BEFORE the mesh facade's node gate, as egress's verbs are
//! (`mgmt/mesh_egress.rs`), in egress's refusal order (W3-1, VF-PM
//! 2026-11-06), which is the contract's:
//!
//!  1. an arm that cannot pull by a named root (`UnsupportedFileTransfer`, the
//!     only arm production builds at the `=0.7.24` pin) answers EVERY verb
//!     `file-transfer-unsupported`: a capability fact that holds whether or not
//!     a node is up, which the node gate's generic UNAVAILABLE would hide;
//!  2. `subscribe` is answered with no node up: its stream is the arm's, held
//!     on the mesh unit across node rebuilds (W3-2), because fieldd's
//!     NativeLink keeps a refused subscription's replay silent until its next
//!     reconnect;
//!  3. `roots` and `pull` with no node answer the node gate's UNAVAILABLE
//!     (`mesh::unavailable`, `MeshNotUpDetails`);
//!  4. while the login is captured they are refused MESH_CAPTURING, as
//!     `serve.add` is;
//!  5. params the generated types cannot read are PRECONDITION_FAILED;
//!  6. then the arm: `roots` registers each root or answers it ROOT_UNGATED,
//!     and `pull` is refused CONFLICT (by its id, then by its digest), then
//!     RESOURCE_EXHAUSTED past DRIVE_LIMITS.PULLS_IN_FLIGHT.
//!
//! A verb is a method the contract declares (contracts methods.ts: `roots`,
//! `pull`, `subscribe`). Any other name under the prefix is none: `offer` (a
//! push) stays reserved and undeclared there, and a misspelt verb is not one
//! either. Such a name answers NOT_FOUND, as `mesh::handle`'s own unknown names
//! do, AHEAD of step 1, so its answer is the same on every arm (D36: declared
//! == shipped).
//!
//! A pull is answered at once: the mesh worker is serial (`mgmt/mod.rs`,
//! `serve`'s one worker), so a pull it awaited would hold every serve, store
//! and lane call behind it. Its progress and its end ride
//! `native.mesh.fileTransfer.delta` (one method with a `kind`: NativeLink
//! routes only `.delta` and `.snapshot` to a subscription), and a reader the
//! stream outran is owed one `.snapshot`, the door stream's shape
//! (`mgmt/door.rs`): every line goes through `MgmtOutbox::offer_rebuildable`,
//! so the stream never costs fieldd its connection.
//!
//! A snapshot, the subscribe answer's included, is built and queued in one
//! hold of the arm's lock (`FileTransferBackend::write_snapshot`), the lock a
//! pull's row enters under, and a pull is answered only once its row is in:
//! so on one connection a snapshot never omits a pull still running whose
//! answer was written before it (the snapshot write-order rule (W3-16, VF-PM
//! 2026-11-06)). The rule holds because the line is queued INSIDE `write`
//! (`answer_subscribe`, `offer_snapshot`); rows carried out of `write` and
//! queued after it would re-open the race, and this file's rows go red on it.
//!
//! One stream per connection (W3-20, VF-PM 2026-11-06): a `subscribe` on a
//! connection that already holds a file-transfer stream REPLACES it. The
//! stream's forwarder is stopped, and has returned, BEFORE the new subscribe
//! is answered (`FileTransferStreams::replace`, `Stream::end`): every
//! line it queued is queued ahead of that answer, none follows it, and its
//! subId goes quiet. NativeLink's dispose tells the floor nothing, so without
//! this every re-subscribe (W3-16's one re-subscribe for a fresh snapshot among
//! them) would leave a forwarder writing until its connection closed.
//!
//! CONTROL ONLY (EL2): no byte of an object crosses this channel.

use crate::contracts::{
    MeshMode, NativeFileTransferPullParams, NativeFileTransferRootsParams, NativeFileTransferRow,
};
use crate::registries::mesh_file_transfer;
use crate::services::file_transfer::{lock, FileTransferBackend, FileTransferError, PullEvent};
use crate::state::{DaemonState, MgmtOutbox, Offered};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast::{self, error::RecvError, error::TryRecvError};
use tokio::sync::oneshot;

use super::{err, ok, send};

type Tx = MgmtOutbox;

const ROOTS: &str = "native.mesh.fileTransfer.roots";
const PULL: &str = "native.mesh.fileTransfer.pull";
const SUBSCRIBE: &str = "native.mesh.fileTransfer.subscribe";
/// The stream's two notifications (contracts mgmt.ts, the file transfer's
/// header).
const DELTA: &str = "native.mesh.fileTransfer.delta";
const SNAPSHOT: &str = "native.mesh.fileTransfer.snapshot";
/// How long a stream owed a snapshot waits for the outbox's headroom before it
/// offers again (the door stream's, `mgmt/door.rs`).
const SNAPSHOT_RETRY: Duration = Duration::from_millis(100);

/// `conn_id` is the connection the request came on (`mgmt/mod.rs`,
/// `handle_conn`); a `subscribe` replaces the stream that connection holds
/// (W3-20).
pub async fn handle(
    state: &Arc<DaemonState>,
    conn_id: u64,
    tx: &Tx,
    method: &str,
    params: &Value,
    id: Option<Value>,
) {
    if !matches!(method, ROOTS | PULL | SUBSCRIBE) {
        send(
            tx,
            err(id, "NOT_FOUND", -32601, "method not found", false, None),
        );
        return;
    }
    let arm = state.mesh.file_transfer();
    if !arm.supported() {
        send(tx, unsupported(id));
        return;
    }
    if method == SUBSCRIBE {
        subscribe(
            &state.file_transfer_streams,
            conn_id,
            state.sub_id(),
            tx,
            &arm,
            id,
        )
        .await;
        return;
    }
    if !state.mesh.node_present() {
        send(tx, super::mesh::unavailable(state, id));
        return;
    }
    if state.mesh.mode() == Some(MeshMode::Capture) {
        // The belt `serve.add` and `store.set` wear (mesh.rs): the node is
        // ungated while the login is captured, so nothing is declared on it
        // and nothing is pulled through it until it is linked.
        send(
            tx,
            err(
                id,
                "PRECONDITION_FAILED",
                -32005,
                "the mesh is capturing a tailscale login; nothing is declared or pulled until it is linked",
                true,
                Some(json!({ "code": "MESH_CAPTURING" })),
            ),
        );
        return;
    }
    let resp = if method == ROOTS {
        roots(state, &arm, params, id).await
    } else {
        pull(state, &arm, params, id)
    };
    send(tx, resp);
}

async fn roots(
    state: &Arc<DaemonState>,
    arm: &Arc<dyn FileTransferBackend>,
    params: &Value,
    id: Option<Value>,
) -> Value {
    let parsed = match serde_json::from_value::<NativeFileTransferRootsParams>(params.clone()) {
        Ok(parsed) => parsed,
        Err(e) => return malformed(id, "roots expects {roots: [a named root]}", &e),
    };
    // The gate the INSTALLED node was built with, read per request as the
    // facade reads it (`mesh::handle`), and the posture's login the set is
    // bound to (contracts mgmt.ts `NativeFileTransferRootsParams`).
    let gated = !state.mesh.login_allow().is_empty();
    match arm.roots(parsed.roots, gated, state.mesh.login()).await {
        Ok(roots) => ok(id, json!({ "roots": roots })),
        Err(e) => refusal(state, id, e),
    }
}

fn pull(
    state: &Arc<DaemonState>,
    arm: &Arc<dyn FileTransferBackend>,
    params: &Value,
    id: Option<Value>,
) -> Value {
    let parsed = match serde_json::from_value::<NativeFileTransferPullParams>(params.clone()) {
        Ok(parsed) => parsed,
        Err(e) => {
            return malformed(
                id,
                "pull expects {transferId, peer, root, path, digest}",
                &e,
            )
        }
    };
    let transfer_id = parsed.transfer_id.clone();
    match arm.pull(parsed) {
        Ok(()) => ok(id, json!({ "transferId": transfer_id })),
        Err(e) => refusal(state, id, e),
    }
}

/// A stream `sub_id` for `conn_id`, replacing the one `streams` holds for it
/// (W3-20). The previous stream ends whole before this one is answered, so no
/// line of its follows the answer. It ends whether or not this subscribe is
/// answered with a snapshot: the reader asked for a stream in its place. So a
/// subscribe answered INTERNAL (an arm that writes no snapshot) leaves its
/// connection with no stream, and a reader that keeps its old subscription
/// when a subscribe is refused hears nothing on it until it subscribes again.
/// No production arm is answered so: `NamedRootsFileTransfer` always calls
/// `write` (`services/file_transfer.rs`), and `UnsupportedFileTransfer` is
/// answered at step 1, before this runs.
async fn subscribe(
    streams: &FileTransferStreams,
    conn_id: u64,
    sub_id: String,
    tx: &Tx,
    arm: &Arc<dyn FileTransferBackend>,
    id: Option<Value>,
) {
    let (registration, previous) = streams.replace(conn_id, &sub_id);
    if let Some(previous) = previous {
        previous.end().await;
    }
    // Subscribe BEFORE the snapshot, answer BEFORE forwarding (the door
    // stream's order): an end in between is a delta for a row the snapshot may
    // still list, never a miss. On a replace, an event the old forwarder had
    // not received when it stopped (it returns at its stop without draining
    // its receiver), or one the arm sent between that return and the
    // `arm.subscribe()` below, reaches neither stream. The answer's snapshot
    // then settles that pull by the contract's resync rule (contracts mgmt.ts
    // `NativeFileTransferSnapshot`: completed when its landed name is in
    // `lands`, FAILED_IO otherwise), so a failed pull's own word can read
    // FAILED_IO, as after a lag ("its own word was in the delta the lag
    // lost").
    let events = arm.subscribe();
    if answer_subscribe(&**arm, tx, id, &sub_id) {
        // The arm the stream subscribed to, never a fresh read of the mesh
        // unit's: its snapshots and its events are one arm's.
        spawn_forwarder(arm.clone(), tx.clone(), events, sub_id, registration);
    }
    // Answered INTERNAL instead: no stream starts, and `registration`, never
    // handed to a forwarder, takes its entry out of the map as it drops here.
}

/// W3-20 (VF-PM 2026-11-06) — the one file-transfer stream each management
/// connection holds, by the server's connection id (`mgmt/mod.rs`,
/// `handle_conn`'s `conn_id`, which the mesh worker hands `mesh::handle`).
/// `DaemonState` keeps it. Only the one mesh worker (`mgmt/mod.rs`, `serve`)
/// runs `subscribe`, so two subscribes never interleave. It is keyed by
/// connection because W3-20 is a rule of one connection. With one current
/// client at a time (that worker runs only the current client's requests,
/// `DaemonState::is_current_client`), the keying is not visible from outside:
/// a superseded connection's forwarder ends with that connection.
///
/// An entry goes in BEFORE its forwarder is spawned, and leaves the map by a
/// later subscribe's `replace` (whose caller then waits for that forwarder's
/// end), or when the forwarder's `Registration` drops, which takes it out
/// only while it is still its own. A forwarder ends with its connection
/// (`MgmtOutbox::closed`), so the map holds at most one entry per open
/// connection, and none for a connection that is gone.
///
/// The map's lock is held for one insert, or one lookup and remove, and
/// nothing else: no `.await` under it, no call into the arm (whose lock
/// `write_snapshot` holds) or the outbox, and no channel end dropped under it.
/// And no lock of the floor's is held when it is taken: `subscribe` holds
/// none, and a `Registration` drops as its forwarder returns (or with its
/// future, if the runtime drops it unfinished), and a forwarder holds no lock
/// at a return or an await. So it orders against no other lock.
#[derive(Default)]
pub(crate) struct FileTransferStreams {
    by_conn: ByConn,
}

type ByConn = Arc<Mutex<HashMap<u64, Stream>>>;

/// A connection's stream, as the map holds it.
struct Stream {
    sub_id: String,
    /// Dropped by `end`: the forwarder's `Registration::stop` resolves, and it
    /// returns at its next await.
    stop: oneshot::Sender<()>,
    /// Resolves once the forwarder has returned (its `Registration`, a local
    /// of its body, drops at the return), so after every line it queued.
    ended: oneshot::Receiver<()>,
}

impl Stream {
    /// Stop the forwarder and wait until it has returned: every line it
    /// queued is queued by then, and it queues none after. A line it had in
    /// hand when `stop` came (a delta, or an owed snapshot) is queued before
    /// the replacing subscribe's answer, on its old subId. fieldd's reader
    /// disposes its old subscription only once that answer is read (DR-3b,
    /// `drive/pulls.ts`, `#doSubscribe`), so it still routes the line there;
    /// the answer's snapshot, built after it in one hold of the arm's lock,
    /// supersedes it, and the write order (W3-16) holds for both. When the
    /// reader's re-subscribe times out instead (its TIMEOUT, `mayHaveRun`),
    /// it drops the old subscription before the late answer, so that line has
    /// no route; the plain subscribe it sends next answers a snapshot built
    /// after the line, which settles the line's pull by the resync rule
    /// (contracts `NativeFileTransferSnapshot`). The
    /// forwarder waits on nothing the mesh worker holds, and between two
    /// awaits it runs a `try_recv`, a `try_send` or a `write_snapshot`, so the
    /// wait is bounded.
    async fn end(self) {
        let Stream { stop, ended, .. } = self;
        drop(stop);
        let _ = ended.await;
    }
}

/// What a forwarder holds of its entry: it moves into the forwarder's body (a
/// local, `spawn_forwarder`) and drops when the forwarder returns.
struct Registration {
    by_conn: ByConn,
    conn_id: u64,
    sub_id: String,
    /// The `stop` its `Stream` holds: resolved, the forwarder returns.
    stop: oneshot::Receiver<()>,
    /// Dropped with the rest of the registration: its `Stream::ended`
    /// resolves.
    _ended: oneshot::Sender<()>,
}

impl FileTransferStreams {
    /// Make `sub_id` the stream `conn_id` holds, in one hold of the map, and
    /// hand back the stream it replaces, for the caller to `end` BEFORE it
    /// answers.
    fn replace(&self, conn_id: u64, sub_id: &str) -> (Registration, Option<Stream>) {
        let (stop, stopped) = oneshot::channel();
        let (ended_tx, ended) = oneshot::channel();
        let stream = Stream {
            sub_id: sub_id.to_owned(),
            stop,
            ended,
        };
        let previous = lock(&self.by_conn).insert(conn_id, stream);
        let registration = Registration {
            by_conn: self.by_conn.clone(),
            conn_id,
            sub_id: sub_id.to_owned(),
            stop: stopped,
            _ended: ended_tx,
        };
        (registration, previous)
    }
}

impl Drop for Registration {
    /// The forwarder ended (its connection closed, its arm's stream did, or a
    /// replacing subscribe stopped it), or was never spawned (its subscribe
    /// was answered INTERNAL): its entry leaves the map, unless a later
    /// subscribe has put its own in already.
    fn drop(&mut self) {
        let mut by_conn = lock(&self.by_conn);
        let own = by_conn
            .get(&self.conn_id)
            .is_some_and(|held| held.sub_id == self.sub_id);
        let mine = if own {
            by_conn.remove(&self.conn_id)
        } else {
            None
        };
        drop(by_conn);
        // its channels' ends drop with the map's lock free
        drop(mine);
    }
}

/// The subscribe answer. It carries a snapshot, so it is queued as the
/// forwarder's is, INSIDE `write` (the snapshot write-order rule (W3-16, VF-PM
/// 2026-11-06)). The one mesh worker (`mgmt/mod.rs`, `serve`'s one worker)
/// already runs this and every pull one at a time; the arm's lock keeps the
/// rule true without leaning on that. An arm that never calls `write` would
/// leave the request unanswered, so it is answered INTERNAL instead, and no
/// stream starts: `false`. A second call writes nothing.
fn answer_subscribe(
    arm: &dyn FileTransferBackend,
    tx: &Tx,
    id: Option<Value>,
    sub_id: &str,
) -> bool {
    let mut unanswered = Some(id);
    arm.write_snapshot(&mut |rows| {
        if let Some(id) = unanswered.take() {
            let snapshot = snapshot_json(&rows);
            send(tx, ok(id, json!({ "subId": sub_id, "snapshot": snapshot })));
        }
    });
    let Some(id) = unanswered else {
        return true;
    };
    send(
        tx,
        err(
            id,
            "INTERNAL",
            -32000,
            "the file transfer wrote no snapshot",
            false,
            None,
        ),
    );
    false
}

/// Step 1's answer, the `error-data.file-transfer-unsupported` golden key for
/// key (`tests/mgmt_server.rs` holds the floor's own answer to it): retryable
/// false, because it is a fact for the floor's life, and its words are the
/// generated registry's.
fn unsupported(id: Option<Value>) -> Value {
    err(
        id,
        "UNAVAILABLE",
        -32006,
        "file transfer is unsupported: this floor's truffle cannot pull by a named root",
        false,
        Some(json!({
            "service": mesh_file_transfer::SERVICE,
            "state": mesh_file_transfer::STATE_UNSUPPORTED,
        })),
    )
}

/// An arm's refusal on the wire. CONFLICT is the
/// `error-data.file-transfer-conflict` golden: no details, retryable false
/// (DR-2a's review nit 9: fieldd's own table keeps both cases from the floor,
/// so this is a belt). RESOURCE_EXHAUSTED is the
/// `error-data.file-transfer-exhausted` golden (W3-15, VF-PM 2026-11-06;
/// contracts mgmt.ts `NativeFileTransferPullParams`): retryable true, because
/// a pull may be asked again once a running one ends, and no details.
/// `tests/mesh_file_transfer.rs`'s row 10 holds the floor's answer to it key
/// for key.
fn refusal(state: &Arc<DaemonState>, id: Option<Value>, e: FileTransferError) -> Value {
    match e {
        FileTransferError::Unsupported => unsupported(id),
        FileTransferError::MeshDown => super::mesh::unavailable(state, id),
        FileTransferError::Conflict(why) => err(id, "CONFLICT", -32004, why, false, None),
        FileTransferError::Exhausted => err(
            id,
            "RESOURCE_EXHAUSTED",
            -32010,
            "as many pulls as the floor runs at once are running",
            true,
            None,
        ),
    }
}

fn malformed(id: Option<Value>, expects: &str, e: &serde_json::Error) -> Value {
    err(
        id,
        "PRECONDITION_FAILED",
        -32005,
        &format!("{expects}: {e}"),
        false,
        None,
    )
}

/// The stream's snapshot as the contract spells it
/// (`NativeFileTransferSnapshot`).
fn snapshot_json(rows: &[NativeFileTransferRow]) -> Value {
    json!({ "transfers": rows })
}

/// One delta as the contract spells it (`NativeFileTransferDelta`): `kind` is
/// the zod discriminator's word.
fn delta_json(event: &PullEvent) -> Value {
    match event {
        PullEvent::Progress {
            transfer_id,
            bytes,
            total,
        } => json!({
            "kind": "progress",
            "transferId": transfer_id,
            "bytes": bytes,
            "total": total,
        }),
        PullEvent::Completed {
            transfer_id,
            digest,
            incoming,
            bytes,
            sha256,
        } => json!({
            "kind": "completed",
            "transferId": transfer_id,
            "digest": digest,
            "incoming": incoming,
            "bytes": bytes,
            "sha256": sha256,
        }),
        PullEvent::Failed {
            transfer_id,
            reason,
            message,
        } => json!({
            "kind": "failed",
            "transferId": transfer_id,
            "reason": reason,
            "message": message,
        }),
    }
}

fn note(method: &str, sub_id: &str, payload: Value) -> String {
    json!({"jsonrpc": "2.0", "method": method, "params": {"subId": sub_id, "payload": payload}})
        .to_string()
}

/// Why `offer_snapshot` ends a stream: its connection closed, or the arm's
/// stream did (or the arm wrote no snapshot). A forwarder also stops when a
/// later subscribe on its connection replaces it (W3-20, `Stream::end`), which
/// is its `Registration::stop`, never this.
#[derive(Debug, PartialEq, Eq)]
struct StreamEnded;

/// A stream's owed snapshot, offered as rebuildable. `write` drains what the
/// snapshot covers, then queues its line, all in ONE hold of the arm's lock,
/// never in steps. The serial mesh worker's pull enters the table before the
/// rows are built (they list it) or after the line is queued (its answer
/// follows it): the snapshot write-order rule (W3-16, VF-PM 2026-11-06). And
/// the arm sends every event under that lock (`NamedRootsFileTransfer`'s
/// `finish`, `note_progress` and `detach`), so an event sent before the hold
/// is drained, never sent again as a delta, and every delta after the
/// snapshot reports a state newer than it. An arm that never calls `write`
/// ends the stream.
fn offer_snapshot(
    arm: &dyn FileTransferBackend,
    tx: &Tx,
    sub_id: &str,
    events: &mut broadcast::Receiver<PullEvent>,
) -> Result<Offered, StreamEnded> {
    let mut offered = Err(StreamEnded);
    arm.write_snapshot(&mut |rows| {
        loop {
            match events.try_recv() {
                Ok(_) | Err(TryRecvError::Lagged(_)) => {}
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Closed) => return,
            }
        }
        offered = tx
            .offer_rebuildable(note(SNAPSHOT, sub_id, snapshot_json(&rows)))
            .map_err(|_| StreamEnded);
    });
    offered
}

/// The stream's forwarder, the door stream's shape (`mgmt/door.rs`): every
/// line is offered as rebuildable, and a line the outbox has no headroom for,
/// or a lag past the arm's event buffer, owes the reader one `.snapshot`,
/// offered until it fits (`offer_snapshot`). It reads the arm `subscribe` was
/// handed, the one its events come from; production never swaps the arm
/// (`services/mesh.rs`, `Shared.file_transfer`). It ends with its connection,
/// with the arm's stream, or when a later subscribe on its connection
/// replaces it (W3-20): each wait is a `biased` select that reads the stop
/// first, so it returns at its next await, and its `Registration`, a local of
/// its body, drops as it returns.
fn spawn_forwarder(
    arm: Arc<dyn FileTransferBackend>,
    tx: Tx,
    mut events: broadcast::Receiver<PullEvent>,
    sub_id: String,
    registration: Registration,
) {
    tokio::spawn(async move {
        // Moved into the body, so it drops the moment the forwarder returns
        // (`mgmt/door.rs` holds its subscriber the same way).
        let mut registration = registration;
        let mut owed = false;
        loop {
            if owed {
                match offer_snapshot(&*arm, &tx, &sub_id, &mut events) {
                    Ok(Offered::Queued) => owed = false,
                    Ok(Offered::Skipped) => {
                        tokio::select! {
                            biased;
                            _ = &mut registration.stop => return,
                            _ = tx.closed() => return,
                            _ = tokio::time::sleep(SNAPSHOT_RETRY) => {}
                        }
                    }
                    Err(StreamEnded) => return,
                }
                continue;
            }
            let event = tokio::select! {
                biased;
                _ = &mut registration.stop => return,
                _ = tx.closed() => return,
                event = events.recv() => event,
            };
            let payload = match event {
                Ok(event) => delta_json(&event),
                Err(RecvError::Lagged(_)) => {
                    owed = true;
                    continue;
                }
                Err(RecvError::Closed) => return,
            };
            match tx.offer_rebuildable(note(DELTA, &sub_id, payload)) {
                Ok(Offered::Queued) => {}
                Ok(Offered::Skipped) => owed = true,
                Err(_) => return,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{
        Blake3Hex, ErrorData, ErrorKind, FileTransferId, FileTransferRootName,
        NativeFileTransferPullResult, NativeFileTransferRoot, NativeFileTransferSnapshot,
    };
    use crate::services::file_transfer::PullSubstrate;
    use crate::state::OutMsg;
    use tokio::sync::mpsc;

    const TRANSFER_ID: &str = "01JC8ZK4W2MX7N3Q5R9T6V0B1D";
    const DIGEST: &str = "b02750d32042f3e5061f34a1d35dd4c03cf03266de5063222e68afeca8b4b201";

    fn progress(bytes: u64) -> PullEvent {
        PullEvent::Progress {
            transfer_id: FileTransferId::try_from(TRANSFER_ID).unwrap(),
            bytes,
            total: 48_213,
        }
    }

    /// An arm whose lock the test sees the edges of. Inside `write_snapshot`
    /// it sends `progress(16_384)` on its stream, then calls `write` with its
    /// one row; once `write` returns, it sends `progress(32_768)` and queues
    /// `answer` on the connection. That is what the serial mesh worker does
    /// the moment a real arm's lock is free: a pull's event, and that pull's
    /// answer. With `writes` false it calls nothing and queues nothing.
    struct EdgesArm {
        writes: bool,
        events: broadcast::Sender<PullEvent>,
        tx: MgmtOutbox,
        /// a pull's answer, as `pull` writes it
        answer: String,
    }

    impl EdgesArm {
        fn new(writes: bool, tx: &MgmtOutbox) -> Self {
            Self {
                writes,
                events: broadcast::channel(8).0,
                tx: tx.clone(),
                answer: ok(Some(json!(9)), json!({ "transferId": TRANSFER_ID })).to_string(),
            }
        }
    }

    #[async_trait::async_trait]
    impl FileTransferBackend for EdgesArm {
        fn arm(&self) -> &'static str {
            "edges"
        }
        fn supported(&self) -> bool {
            true
        }
        async fn attach(&self, _: Arc<dyn PullSubstrate>, _: bool, _: Option<String>) {}
        async fn detach(&self, _: &str) {}
        async fn roots(
            &self,
            _: Vec<FileTransferRootName>,
            _: bool,
            _: Option<String>,
        ) -> Result<Vec<NativeFileTransferRoot>, FileTransferError> {
            Err(FileTransferError::Unsupported)
        }
        fn pull(&self, _: NativeFileTransferPullParams) -> Result<(), FileTransferError> {
            Err(FileTransferError::Unsupported)
        }
        fn write_snapshot(&self, write: &mut dyn FnMut(Vec<NativeFileTransferRow>)) {
            if !self.writes {
                return;
            }
            let _ = self.events.send(progress(16_384));
            write(vec![NativeFileTransferRow {
                bytes: 16_384,
                digest: Blake3Hex::try_from(DIGEST).unwrap(),
                peer: "n4Kd8xQ2pLmR".into(),
                root: FileTransferRootName::DriveObjects,
                total: Some(48_213),
                transfer_id: FileTransferId::try_from(TRANSFER_ID).unwrap(),
            }]);
            let _ = self.events.send(progress(32_768));
            self.tx.send(OutMsg::Line(self.answer.clone())).unwrap();
        }
        fn subscribe(&self) -> broadcast::Receiver<PullEvent> {
            self.events.subscribe()
        }
    }

    /// Every line the connection holds now, in order.
    fn lines(rx: &mut mpsc::Receiver<OutMsg>) -> Vec<Value> {
        let mut lines = Vec::new();
        while let Ok(OutMsg::Line(line)) = rx.try_recv() {
            lines.push(serde_json::from_str(&line).unwrap());
        }
        lines
    }

    /// The transferIds a snapshot lists, read through the generated type.
    fn listed(snapshot: &Value) -> Vec<String> {
        let snapshot: NativeFileTransferSnapshot =
            serde_json::from_value(snapshot.clone()).unwrap();
        snapshot
            .transfers
            .into_iter()
            .map(|row| row.transfer_id.as_str().to_owned())
            .collect()
    }

    /// The snapshot write-order rule (W3-16, VF-PM 2026-11-06), at the facade:
    /// the subscribe answer and an owed snapshot are queued INSIDE `write`, so
    /// the pull's answer the arm queues the moment its lock is free follows
    /// each of them and never comes first. The owed snapshot's drain runs
    /// inside the hold too: the event sent just before `write` is drained,
    /// and the one sent after it waits to be forwarded. The frames are the
    /// facade's own, read through the generated types (EL9).
    /// Probe: carry the rows out of `write` and queue the line once
    /// `write_snapshot` returns (two steps) → the pull's answer is the first
    /// line; drain before `write_snapshot` → the first event left is
    /// `progress(16_384)`.
    #[test]
    fn a_snapshot_line_is_queued_before_the_arms_lock_is_free() {
        let (tx, mut rx, _close) = MgmtOutbox::channel();
        let arm = EdgesArm::new(true, &tx);
        let pull_answer: Value = serde_json::from_str(&arm.answer).unwrap();

        assert!(answer_subscribe(&arm, &tx, Some(json!(7)), "s1"));
        let queued = lines(&mut rx);
        let [subscribed, answer] = queued.as_slice() else {
            panic!("the subscribe answer, then the pull's, and nothing else: {queued:?}");
        };
        assert_eq!(subscribed["id"], 7);
        assert_eq!(subscribed["result"]["subId"], "s1");
        assert_eq!(listed(&subscribed["result"]["snapshot"]), [TRANSFER_ID]);
        assert_eq!(*answer, pull_answer);
        let _: NativeFileTransferPullResult =
            serde_json::from_value(answer["result"].clone()).unwrap();

        let mut events = arm.subscribe();
        assert_eq!(
            offer_snapshot(&arm, &tx, "s1", &mut events),
            Ok(Offered::Queued)
        );
        let queued = lines(&mut rx);
        let [owed, answer] = queued.as_slice() else {
            panic!("the snapshot, then the pull's answer, and nothing else: {queued:?}");
        };
        assert_eq!(owed["method"], SNAPSHOT);
        assert_eq!(owed["params"]["subId"], "s1");
        assert_eq!(listed(&owed["params"]["payload"]), [TRANSFER_ID]);
        assert_eq!(*answer, pull_answer);
        assert_eq!(
            events.try_recv(),
            Ok(progress(32_768)),
            "the event sent after the hold waits to be forwarded"
        );
        assert_eq!(events.try_recv(), Err(TryRecvError::Empty));
    }

    /// An arm that never calls `write` leaves no request unanswered: the
    /// subscribe is answered INTERNAL and starts no stream, and an owed
    /// snapshot ends the stream rather than owe it forever.
    /// Probe: answer only inside `write` → no line comes, and a stream is
    /// said to start.
    #[test]
    fn an_arm_that_writes_no_snapshot_is_answered_and_streams_nothing() {
        let (tx, mut rx, _close) = MgmtOutbox::channel();
        let arm = EdgesArm::new(false, &tx);
        assert!(!answer_subscribe(&arm, &tx, Some(json!(7)), "s1"));
        let queued = lines(&mut rx);
        let [refused] = queued.as_slice() else {
            panic!("one refusal and nothing else: {queued:?}");
        };
        assert_eq!(refused["id"], 7);
        let data: ErrorData = serde_json::from_value(refused["error"]["data"].clone()).unwrap();
        assert_eq!(data.kind, ErrorKind::Internal);
        assert!(!data.retryable);
        let mut events = arm.subscribe();
        assert_eq!(
            offer_snapshot(&arm, &tx, "s1", &mut events),
            Err(StreamEnded)
        );
        assert!(lines(&mut rx).is_empty());
    }

    /// The connections the W3-20 map holds a stream for, each with its subId.
    fn held(streams: &FileTransferStreams) -> Vec<(u64, String)> {
        let mut held: Vec<(u64, String)> = lock(&streams.by_conn)
            .iter()
            .map(|(conn_id, stream)| (*conn_id, stream.sub_id.clone()))
            .collect();
        held.sort();
        held
    }

    /// W3-20 (VF-PM 2026-11-06), at `subscribe`: a subscribe on a connection
    /// that holds a stream stops that stream's forwarder and is answered only
    /// once the forwarder has returned. The test holds the first stream's
    /// `Registration` as its forwarder's body would, so that forwarder's
    /// return is the test's `drop`: until then the second subscribe waits with
    /// nothing queued, and the map already holds the second stream, which the
    /// first registration's drop leaves in place.
    /// Probe: `drop(previous)` in place of `previous.end().await` → the first
    /// poll answers; end the previous stream after `answer_subscribe` → a line
    /// is queued while the first forwarder lives; a `Registration` that takes
    /// out whatever its connection holds → the second stream is gone.
    #[tokio::test]
    async fn a_replacing_subscribe_is_answered_once_the_old_forwarder_has_returned() {
        let (tx, mut rx, _close) = MgmtOutbox::channel();
        let arm: Arc<dyn FileTransferBackend> = Arc::new(EdgesArm::new(true, &tx));
        let streams = FileTransferStreams::default();
        let (mut first, none) = streams.replace(1, "s1");
        assert!(none.is_none(), "the connection held no stream");

        let second = subscribe(&streams, 1, "s2".to_owned(), &tx, &arm, Some(json!(7)));
        let mut second = std::pin::pin!(second);
        assert!(
            futures_util::FutureExt::now_or_never(second.as_mut()).is_none(),
            "the second subscribe waits for the first forwarder"
        );
        assert!(lines(&mut rx).is_empty(), "nothing is queued yet");
        assert_eq!(
            first.stop.try_recv(),
            Err(oneshot::error::TryRecvError::Closed),
            "the first forwarder is told to stop"
        );
        assert_eq!(held(&streams), [(1, "s2".to_owned())]);

        drop(first);
        second.await;
        let queued = lines(&mut rx);
        let [subscribed, _pull_answer] = queued.as_slice() else {
            panic!("the subscribe answer, then the arm's pull answer: {queued:?}");
        };
        assert_eq!(subscribed["id"], 7);
        assert_eq!(subscribed["result"]["subId"], "s2");
        assert_eq!(
            held(&streams),
            [(1, "s2".to_owned())],
            "the first registration left the second stream in place"
        );
    }

    /// W3-20's map holds no stream for a connection that is gone, or for a
    /// subscribe that started none: a forwarder returns when its connection
    /// closes (`MgmtOutbox::closed`) and its `Registration` takes its entry
    /// out, and a subscribe answered INTERNAL takes its own out as it returns.
    /// Each connection keeps its own entry until then.
    /// Probe: a `Registration` whose drop takes nothing out → the refused
    /// subscribe's entry stays, and the closed connection's; key the map by
    /// one connection for all → the refused subscribe takes the first one's
    /// out.
    #[tokio::test]
    async fn a_stream_leaves_the_map_with_its_connection_or_its_refusal() {
        let streams = FileTransferStreams::default();
        let (tx, mut rx, _close) = MgmtOutbox::channel();
        let arm: Arc<dyn FileTransferBackend> = Arc::new(EdgesArm::new(true, &tx));
        subscribe(&streams, 1, "s1".to_owned(), &tx, &arm, Some(json!(7))).await;
        assert_eq!(lines(&mut rx)[0]["result"]["subId"], "s1");

        let (tx2, mut rx2, _close2) = MgmtOutbox::channel();
        let arm2: Arc<dyn FileTransferBackend> = Arc::new(EdgesArm::new(false, &tx2));
        subscribe(&streams, 2, "s2".to_owned(), &tx2, &arm2, Some(json!(8))).await;
        let queued = lines(&mut rx2);
        let [refused] = queued.as_slice() else {
            panic!("one refusal and nothing else: {queued:?}");
        };
        let data: ErrorData = serde_json::from_value(refused["error"]["data"].clone()).unwrap();
        assert_eq!(data.kind, ErrorKind::Internal);
        assert_eq!(
            held(&streams),
            [(1, "s1".to_owned())],
            "the refused subscribe left no entry, and the first connection's stays"
        );

        tx.signal_closed();
        // `#[tokio::test]` runs on one thread: the forwarder runs at the
        // test's next yield, reads its connection closed and returns.
        for _ in 0..100 {
            if held(&streams).is_empty() {
                break;
            }
            tokio::task::yield_now().await;
        }
        assert!(
            held(&streams).is_empty(),
            "the closed connection's stream left the map"
        );
    }

    fn golden(name: &str) -> Value {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures")
            .join(name);
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    /// EL9 at the writer: the stream's lines ARE the goldens, key for key, so
    /// fieldd's zod reader and this writer cannot drift apart.
    #[test]
    fn the_stream_lines_are_the_goldens() {
        let id = FileTransferId::try_from("01JC8ZK4W2MX7N3Q5R9T6V0B1D").unwrap();
        let digest =
            Blake3Hex::try_from("b02750d32042f3e5061f34a1d35dd4c03cf03266de5063222e68afeca8b4b201")
                .unwrap();
        let progress = PullEvent::Progress {
            transfer_id: id.clone(),
            bytes: 16_384,
            total: 48_213,
        };
        assert_eq!(
            delta_json(&progress),
            golden("native-file-transfer-delta.progress.json")
        );
        let completed = PullEvent::Completed {
            transfer_id: id.clone(),
            digest: digest.clone(),
            incoming: format!("{}.{}", digest.as_str(), id.as_str()),
            bytes: 48_213,
            sha256: "075eeb056ba8f587858fe88dd968e5d29207d6537944d88d8826a56cb8e89a42".into(),
        };
        assert_eq!(
            delta_json(&completed),
            golden("native-file-transfer-delta.completed.json")
        );
        let failed = PullEvent::Failed {
            transfer_id: id.clone(),
            reason: mesh_file_transfer::FAILED_REJECTED,
            message: "the holder refused the pull".into(),
        };
        assert_eq!(
            delta_json(&failed),
            golden("native-file-transfer-delta.failed.json")
        );
        let row = NativeFileTransferRow {
            bytes: 16_384,
            digest,
            peer: "n4Kd8xQ2pLmR".into(),
            root: FileTransferRootName::DriveObjects,
            total: Some(48_213),
            transfer_id: id,
        };
        assert_eq!(
            snapshot_json(&[row]),
            golden("native-file-transfer-snapshot.valid.json")
        );
        assert_eq!(
            snapshot_json(&[]),
            golden("native-file-transfer-snapshot.empty.json")
        );
    }
}
