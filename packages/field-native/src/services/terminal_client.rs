//! The self-client (NF-D7) — field-native's own client on the control socket it
//! minted the token for. Control-through-sockets IS the architecture
//! (predesign-03 §2.2): the terminal unit learns its inventory and the mgmt
//! seam applies re-policy over the same protocol fieldd uses, never through a
//! private back door. (The shutdown sweep this client used to run moved
//! upstream at NF-7 — G7's `ServiceHandle::shutdown` drains in-process.) G2 (an
//! in-process API) stays the optional latency upgrade and would be invisible
//! above the mgmt seam.
//!
//! Protocol facts below are read from the pinned crate, not from a doc:
//! `ghosttea-0.7.0/src/service.rs` (first verified at 0.6.0; framing and
//! handshake unchanged at 0.7.0). Framing is a little-endian u32 length
//! followed by the payload (service.rs:573-587, mirrored by `packet()` in
//! `@vibecook/ghosttea-client`'s index.ts). The first packet a client sends is
//! the bare auth token — not JSON — and the service answers with the packet
//! `ok` before any command is read (service.rs:600-609). Commands are
//! `{requestId, type: "<kebab-case-op>", ...camelCase}` (service.rs:136-282) and
//! responses come back on the same stream tagged the same way
//! (service.rs:292-352). `requestId: 0` marks a server-pushed event, and the
//! service deliberately writes no response to a request that uses it
//! (service.rs:639) — so this client's ids start at 1.

use anyhow::{bail, ensure, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::UnixStream;
use tokio::sync::{mpsc, oneshot};

/// Control protocol: ghosttea 0.7.0 serves 1.13 and the hello answers
/// `min(client, server)` per connection. This client announces **1.9** — the
/// feature floor it consumes, not the newest it has heard of. The minor is not
/// cosmetic: the service gates events on it — `session-activity-changed` below
/// 1.6, `events-lost` below 1.8, and `session-created` below 1.9
/// (`SESSION_CREATED_PROTOCOL_MINOR`, service.rs:48). 1.9 is what turns
/// creation from a polled fact into a pushed hint (NF-7); the 1.10-1.13
/// reconnect-era answers stay off this connection until something here reads
/// them.
pub const PROTOCOL_MAJOR: u16 = 1;
pub const PROTOCOL_MINOR: u16 = 9;

/// = upstream `MAX_CONTROL_BYTES` (service.rs:27). Reading with the service's
/// own ceiling keeps a hostile or wedged peer from making us allocate.
const MAX_CONTROL_BYTES: usize = 1024 * 1024;

/// A control round trip is a Unix-socket hop into the same process. Anything
/// slower than this is a wedged service, and waiting longer only delays an
/// honest degraded state.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// The subset of ghosttea's `SessionSummary` (session.rs:284-304) this floor
/// reads. Deliberately a tolerant reader of our own rather than upstream's
/// type: `SessionSummary` derives `Serialize` only, and a daemon that must
/// survive a minor-version field addition parses what it needs and ignores the
/// rest.
///
/// The absences are load-bearing, not laziness — see `TERMINAL_INVENTORY_GAPS`
/// in `terminal.rs`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    #[serde(default)]
    pub pid: Option<u32>,
    /// Epoch millis (upstream `created_at_ms`), which is also what
    /// `ObservedTerminal.createdAt` is defined as — no unit conversion.
    #[serde(default)]
    pub created_at_ms: Option<u64>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    /// True for a session the registry still holds after its process exited —
    /// only `keep-until-explicit-close` sessions can be in this state.
    /// Nothing may await an exit event from one.
    #[serde(default)]
    pub exited: bool,
    /// G9 (0.7.0): kebab-case policy name — `Some` for locally governed
    /// sessions, absent for remote replicas. Opaque passthrough into
    /// `ObservedTerminal.persistence` (reference-don't-remodel).
    #[serde(default)]
    pub persistence: Option<String>,
}

/// An authenticated control connection, plus the pushed-event stream that came
/// with it. Events and responses share one socket, so they are demultiplexed by
/// a single reader task; the event half is handed to the caller as a channel.
pub struct ControlClient {
    writer: tokio::sync::Mutex<tokio::io::WriteHalf<UnixStream>>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_request_id: AtomicU64,
    reader: tokio::task::JoinHandle<()>,
}

impl Drop for ControlClient {
    fn drop(&mut self) {
        // Abort-on-drop: a reader task outliving its client would hold the
        // socket open and keep a control slot on the service for nothing.
        self.reader.abort();
    }
}

impl ControlClient {
    /// Dial, authenticate, and greet. Returns the client and the stream of
    /// server-pushed events (`requestId: 0`) received from this moment on —
    /// which is why callers subscribe before they reconcile: an exit that
    /// happens during the reconcile is buffered here, not lost.
    ///
    /// Bounded as a whole, and not only in its parts: the auth ack is a read
    /// with no deadline of its own (`hello` gets the request budget, the ack
    /// before it got nothing), so a service that accepted the connection and
    /// then went quiet would park the caller forever. Callers dial under locks —
    /// the mgmt reconcile holds `state.desired` across its whole prune — which
    /// is what makes an unbounded handshake a daemon-wide stall rather than one
    /// slow call. The budget is the request budget: the handshake is one write
    /// and two round trips into a process on the same machine.
    pub async fn connect(
        control_socket: &Path,
        token: &str,
    ) -> Result<(Self, mpsc::UnboundedReceiver<Value>)> {
        match tokio::time::timeout(REQUEST_TIMEOUT, Self::handshake(control_socket, token)).await {
            Ok(result) => result,
            // Dropping the handshake future closes the half-open socket and
            // aborts any reader task it had already spawned.
            Err(_) => bail!("terminal control handshake did not complete in {REQUEST_TIMEOUT:?}"),
        }
    }

    async fn handshake(
        control_socket: &Path,
        token: &str,
    ) -> Result<(Self, mpsc::UnboundedReceiver<Value>)> {
        let mut stream = UnixStream::connect(control_socket)
            .await
            .with_context(|| format!("dial {}", control_socket.display()))?;

        // The bare token, then the service's `ok`. Never logged, on any path.
        write_packet(&mut stream, token.as_bytes()).await?;
        let ack = read_packet(&mut stream).await.context("read auth ack")?;
        ensure!(ack == b"ok", "control authentication was refused");

        let (read_half, write_half) = tokio::io::split(stream);
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>> = Arc::default();
        let (events_tx, events_rx) = mpsc::unbounded_channel();
        let reader = tokio::spawn(read_loop(read_half, pending.clone(), events_tx));

        let client = Self {
            writer: tokio::sync::Mutex::new(write_half),
            pending,
            next_request_id: AtomicU64::new(1),
            reader,
        };
        client.hello().await?;
        Ok((client, events_rx))
    }

    /// Declare the protocol version. Sent for the same reason the TS client
    /// sends it: the service records the minor per connection and gates newer
    /// events on it (service.rs:634-638).
    async fn hello(&self) -> Result<()> {
        let response = self
            .call(json!({
                "type": "hello",
                "protocolMajor": PROTOCOL_MAJOR,
                "protocolMinor": PROTOCOL_MINOR,
                "clientBuild": concat!("field-native/", env!("CARGO_PKG_VERSION")),
            }))
            .await?;
        let major = response.get("protocolMajor").and_then(Value::as_u64);
        ensure!(
            response.get("type").and_then(Value::as_str) == Some("hello")
                && major == Some(u64::from(PROTOCOL_MAJOR)),
            "terminal control protocol mismatch: {response}"
        );
        Ok(())
    }

    pub async fn list_sessions(&self) -> Result<Vec<SessionSummary>> {
        let response = self.call(json!({"type": "list-sessions"})).await?;
        let sessions = response
            .get("sessions")
            .cloned()
            .context("list-sessions answered without sessions")?;
        serde_json::from_value(sessions).context("parse session summaries")
    }

    /// Create a session. At NF this is the tests' door and the shape
    /// `terminal.create` will use at NF-3; creation over the product plane is
    /// deliberately NOT a mgmt method (design-02 §2.7 — no interactive ops
    /// there).
    pub async fn create_session(&self, options: Value) -> Result<SessionSummary> {
        let response = self
            .call(json!({"type": "create-session", "options": options}))
            .await?;
        let session = response
            .get("session")
            .cloned()
            .context("create-session answered without a session")?;
        serde_json::from_value(session).context("parse created session")
    }

    /// Terminate one session. `source` is on the wire as a kebab-case
    /// `TerminationSource` (session.rs:39-46) and decides the exit
    /// classification every observer sees (`classify_exit`, session.rs:69-83).
    pub async fn terminate(&self, session_id: &str, source: &str) -> Result<()> {
        self.call(json!({"type": "terminate", "sessionId": session_id, "source": source}))
            .await
            .map(|_| ())
    }

    /// G9 re-policy (ghosttea 0.7.0): set a live session's persistence. The
    /// service holds its registry write lock across the write and answers with
    /// the updated summary, so a success here IS the value that will decide
    /// retention — never a lost update. "unknown or remote session" is the
    /// service's own refusal for a session it does not govern.
    pub async fn set_persistence(&self, session_id: &str, persistence: &str) -> Result<()> {
        self.call(json!({
            "type": "set-persistence",
            "sessionId": session_id,
            "persistence": persistence,
        }))
        .await
        .map(|_| ())
    }

    /// One request, one correlated response. `type: "error"` is upstream's
    /// failure shape (service.rs:349-351), so it becomes an `Err` here rather
    /// than a success carrying a message no caller would read.
    async fn call(&self, body: Value) -> Result<Value> {
        let request_id = self.next_request_id.fetch_add(1, Ordering::Relaxed);
        let mut request = body;
        request["requestId"] = json!(request_id);

        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(request_id, tx);

        let bytes = serde_json::to_vec(&request)?;
        let write = {
            let mut writer = self.writer.lock().await;
            write_packet(&mut *writer, &bytes).await
        };
        if let Err(error) = write {
            self.pending.lock().unwrap().remove(&request_id);
            return Err(error).context("write control request");
        }

        let response = match tokio::time::timeout(REQUEST_TIMEOUT, rx).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => {
                bail!("terminal control connection closed before answering");
            }
            Err(_) => {
                self.pending.lock().unwrap().remove(&request_id);
                bail!("terminal control request timed out");
            }
        };
        if response.get("type").and_then(Value::as_str) == Some("error") {
            let message = response
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unspecified");
            bail!("terminal control error: {message}");
        }
        Ok(response)
    }
}

/// Demultiplex one socket: `requestId: 0` is a pushed event, anything else
/// answers a waiter. Two things are dropped rather than fatal here: a response
/// no waiter is left for (a timed-out caller has already given up on it) and an
/// event no receiver is left for (see below).
async fn read_loop(
    read_half: tokio::io::ReadHalf<UnixStream>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    events: mpsc::UnboundedSender<Value>,
) {
    let mut read_half = read_half;
    loop {
        let Ok(packet) = read_packet(&mut read_half).await else {
            break; // service gone or protocol violation; waiters see a closed channel
        };
        let Ok(message) = serde_json::from_slice::<Value>(&packet) else {
            break;
        };
        match message.get("requestId").and_then(Value::as_u64) {
            Some(0) | None => {
                // A dropped receiver DISCARDS the event; it never ends the
                // connection. The service broadcasts every event to every
                // control client (service.rs:470/624), so a client whose owner
                // only wants request/response — the mgmt reconcile's prune —
                // would otherwise have its demultiplexer killed by the first
                // `session-exited` its own ladder caused, and every later
                // request on it would then burn the full request budget waiting
                // for a response nobody is left to read.
                let _ = events.send(message);
            }
            Some(request_id) => {
                let waiter = pending.lock().unwrap().remove(&request_id);
                if let Some(waiter) = waiter {
                    let _ = waiter.send(message);
                }
            }
        }
    }
    pending.lock().unwrap().clear();
}

async fn read_packet<R: AsyncRead + Unpin>(stream: &mut R) -> Result<Vec<u8>> {
    let length = stream.read_u32_le().await? as usize;
    ensure!(length <= MAX_CONTROL_BYTES, "control packet exceeds limit");
    let mut bytes = vec![0; length];
    stream.read_exact(&mut bytes).await?;
    Ok(bytes)
}

async fn write_packet<W: AsyncWrite + Unpin>(stream: &mut W, bytes: &[u8]) -> Result<()> {
    stream.write_u32_le(bytes.len() as u32).await?;
    stream.write_all(bytes).await?;
    stream.flush().await?;
    Ok(())
}
