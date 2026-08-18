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
//! `ghosttea-0.9.2/src/service.rs` (first verified at 0.6.0; framing and
//! handshake unchanged through every pin since). Framing is a little-endian u32
//! length followed by the payload (service.rs:1412-1455, mirrored by `packet()`
//! in `@vibecook/ghosttea-client`'s index.ts). The first packet a client sends
//! is the bare auth token — not JSON — and the service answers with the packet
//! `ok` before any command is read (service.rs:1467-1476). Commands are
//! `{requestId, type: "<kebab-case-op>", ...camelCase}` (service.rs:374-548) and
//! responses come back on the same stream tagged the same way
//! (service.rs:564-702). `requestId: 0` marks a server-pushed event, and the
//! service deliberately writes no response to a request that uses it
//! (service.rs:1593-1620) — so this client's ids start at 1.

use crate::local_ipc;
use crate::resource_pressure::{self, CreateRefusal};
use anyhow::{bail, ensure, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot};

/// Control protocol: ghosttea 0.9.2 serves 1.13. This client announces **1.9** —
/// the feature floor it consumes, not the newest it has heard of. The minor is
/// not cosmetic: the service gates events on it — `session-activity-changed`
/// below 1.6, `events-lost` below 1.8, and `session-created` below 1.9
/// (`SESSION_CREATED_PROTOCOL_MINOR`, service.rs:48). 1.9 is what turns
/// creation from a polled fact into a pushed hint (NF-7); the 1.10-1.13
/// reconnect-era answers stay off this connection until something here reads
/// them.
///
/// Two different numbers, and confusing them is what made this a floor nobody
/// checked. The service RECORDS `min(client, server)` per connection and gates
/// its pushed events on that (service.rs:1583-1592), but the hello RESPONSE
/// carries the server's own ceiling (service.rs:1864-1874) — so the answer is
/// what the server can do, not what was negotiated. That is precisely what makes
/// it checkable, and `hello` checks it.
pub const PROTOCOL_MAJOR: u16 = 1;
pub const PROTOCOL_MINOR: u16 = 9;

/// = upstream `MAX_CONTROL_BYTES` (service.rs:34). Reading with the service's
/// own ceiling keeps a hostile or wedged peer from making us allocate.
const MAX_CONTROL_BYTES: usize = 1024 * 1024;

/// A control round trip is a Unix-socket hop into the same process. Anything
/// slower than this is a wedged service, and waiting longer only delays an
/// honest degraded state.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// The subset of ghosttea's `SessionSummary` (session.rs:296-321) this floor
/// reads. Deliberately a tolerant reader of our own rather than upstream's
/// type: `SessionSummary` derives `Serialize` only, and a daemon that must
/// survive a minor-version field addition parses what it needs and ignores the
/// rest.
///
/// The absences are load-bearing, not laziness: what is here is what the floor
/// has a use for. `persistence` and `owner_id` are the GT-D11 discriminator,
/// `persistence` doubles as the marker that tells a session this device governs
/// from a replica of another's (`terminal.rs`'s `is_governed_here`), and the
/// rest are the `ObservedTerminal` row.
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
    /// Who asked for this session, verbatim from the `ownerId` a create passed
    /// (session.rs:1251 — the summary echoes the option back). `None` is
    /// the whole point: a UI door that states no owner produces an ownerless
    /// birth, and GT-D11 governs exactly those.
    #[serde(default)]
    pub owner_id: Option<String>,
}

/// An authenticated control connection, plus the pushed-event stream that came
/// with it. Events and responses share one socket, so they are demultiplexed by
/// a single reader task; the event half is handed to the caller as a channel.
pub struct ControlClient {
    writer: tokio::sync::Mutex<tokio::io::WriteHalf<local_ipc::ClientStream>>,
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
        endpoint: &str,
        token: &str,
    ) -> Result<(Self, mpsc::UnboundedReceiver<Value>)> {
        match tokio::time::timeout(REQUEST_TIMEOUT, Self::handshake(endpoint, token)).await {
            Ok(result) => result,
            // Dropping the handshake future closes the half-open socket and
            // aborts any reader task it had already spawned.
            Err(_) => bail!("terminal control handshake did not complete in {REQUEST_TIMEOUT:?}"),
        }
    }

    async fn handshake(
        endpoint: &str,
        token: &str,
    ) -> Result<(Self, mpsc::UnboundedReceiver<Value>)> {
        // WIN-D1: the endpoint string is a socket path or a pipe name; the dial
        // (and the windows busy/rotation retry) lives in local_ipc, bounded by
        // the REQUEST_TIMEOUT wrapping this whole handshake.
        let mut stream = local_ipc::connect(endpoint)
            .await
            .with_context(|| format!("dial {endpoint}"))?;

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

    /// Declare the protocol version, and REFUSE a service that cannot serve it.
    ///
    /// Sent for the same reason the TS client sends it: the service records the
    /// minor per connection and gates newer events on it. The minor check beside
    /// the major one is GT-5d's: the whole GT-D11 custody claim rides on
    /// `session-created`, which the service withholds below minor 9 — silently,
    /// because withholding an event is not an error. A downgrade under that
    /// floor would leave `govern_births` with nothing to govern, every workspace
    /// pane back at `terminate-with-app`, and not one line in any log. EL8 makes
    /// that unlikely; the exact pin is also precisely what would make it invisible
    /// when it happened, so the connection states the floor it needs.
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
        // The response carries the SERVER's ceiling, so this reads "can you do
        // what we need", not "what did we agree on".
        let minor = response.get("protocolMinor").and_then(Value::as_u64);
        ensure!(
            minor.is_some_and(|minor| minor >= u64::from(PROTOCOL_MINOR)),
            "terminal control protocol {PROTOCOL_MAJOR}.{PROTOCOL_MINOR} is required and the \
             service serves: {response}"
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
    ///
    /// TC-D6(b): a refusal that comes back is CLASSIFIED before it is returned,
    /// so "the machine is out of descriptors" and "that shell does not exist"
    /// stop being the same sentence. `create_session_classified` is the door for
    /// a caller that needs the class itself rather than a message.
    pub async fn create_session(&self, options: Value) -> Result<SessionSummary> {
        self.create_session_classified(options)
            .await
            .map_err(|refusal| anyhow::anyhow!("{}", refusal.message()))
    }

    /// The classifying create. The refusal type is the return value rather than
    /// an opaque error because the CLASS is what a health surface and a UI both
    /// act on — TC-D6(e)'s states are keyed on it.
    pub async fn create_session_classified(
        &self,
        options: Value,
    ) -> std::result::Result<SessionSummary, CreateRefusal> {
        // The ENOENT arm, answered on THIS side of the wire. ghosttea renders
        // only an error's top context (`service.rs:2960-2965`), and its spawn
        // failure is contexted as "failed to spawn PTY command", so a missing
        // shell arrives with its errno already gone — see `resource_pressure`.
        // Asking the filesystem first is what recovers the answer.
        //
        // Absolute paths only, deliberately: a bare `zsh` is resolved against
        // PATH by the spawner, and re-implementing that lookup here would be a
        // second resolver to disagree with the real one. The kernel stays the
        // final authority either way — a pre-flight that passes decides nothing.
        if let Some(executable) = options.get("executable").and_then(Value::as_str) {
            let path = std::path::Path::new(executable);
            if path.is_absolute() && !path.exists() {
                return Err(CreateRefusal::NotFound {
                    message: format!("shell not found: {executable}"),
                });
            }
        }
        let response = self
            .call(json!({"type": "create-session", "options": options}))
            .await
            .map_err(|error| resource_pressure::classify_wire_message(&format!("{error:#}")))?;
        let session =
            response
                .get("session")
                .cloned()
                .ok_or_else(|| CreateRefusal::Unclassified {
                    message: "create-session answered without a session".into(),
                })?;
        serde_json::from_value(session).map_err(|error| CreateRefusal::Unclassified {
            message: format!("parse created session: {error}"),
        })
    }

    /// Terminate one session. `source` is on the wire as a kebab-case
    /// `TerminationSource` (session.rs:47-52) and decides the exit
    /// classification every observer sees (`classify_exit`, session.rs:75-89).
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
    /// failure shape (service.rs:2962-2964), so it becomes an `Err` here rather
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
    read_half: tokio::io::ReadHalf<local_ipc::ClientStream>,
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
                // control client (one `broadcast::Sender`, one `recv` per
                // connection — service.rs:1640-1646), so a client whose owner
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A control service that accepts any token and answers `hello` with the
    /// version it was told to claim. Exactly as much of the protocol as the
    /// handshake reads and not a line more — the point is to be a SERVICE the
    /// real client dials, not a stub of the client's own expectations.
    fn fake_service(
        endpoint: &str,
        protocol_major: u16,
        protocol_minor: u16,
    ) -> tokio::task::JoinHandle<()> {
        let mut listener =
            local_ipc::Listener::bind(endpoint).expect("bind the fake control endpoint");
        tokio::spawn(async move {
            let Ok(mut stream) = listener.accept().await else {
                return;
            };
            // The bare token, then `ok` — never inspected, this is not the
            // authentication under test.
            if read_packet(&mut stream).await.is_err() {
                return;
            }
            if write_packet(&mut stream, b"ok").await.is_err() {
                return;
            }
            while let Ok(packet) = read_packet(&mut stream).await {
                let Ok(request) = serde_json::from_slice::<Value>(&packet) else {
                    return;
                };
                let response = json!({
                    "requestId": request["requestId"],
                    "type": "hello",
                    "protocolMajor": protocol_major,
                    "protocolMinor": protocol_minor,
                    "serverBuild": "fake-service",
                });
                if write_packet(&mut stream, &serde_json::to_vec(&response).unwrap())
                    .await
                    .is_err()
                {
                    return;
                }
            }
        })
    }

    /// A per-test endpoint under the WIN-D1 law's two shapes. macOS caps a Unix
    /// socket path at ~104 bytes, so unix roots at /tmp (the `sun_path` law
    /// from tests/terminal_unit.rs); pipe names share one machine-wide
    /// namespace, so win32 uniqueness comes from the name itself.
    #[cfg(unix)]
    fn unique_endpoint() -> (String, Option<tempfile::TempDir>) {
        let dir = tempfile::Builder::new()
            .prefix("vfhello")
            .tempdir_in("/tmp")
            .expect("tempdir under /tmp");
        let socket = dir
            .path()
            .join("termctl.sock")
            .to_string_lossy()
            .into_owned();
        (socket, Some(dir))
    }
    #[cfg(windows)]
    fn unique_endpoint() -> (String, Option<tempfile::TempDir>) {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let name = format!(
            r"\\.\pipe\vf-test-hello-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        );
        (name, None)
    }

    async fn handshake_with(protocol_major: u16, protocol_minor: u16) -> Result<()> {
        let (endpoint, _dir) = unique_endpoint();
        let _service = fake_service(&endpoint, protocol_major, protocol_minor);
        ControlClient::connect(&endpoint, "a-token")
            .await
            .map(|_| ())
    }

    /// GT-5d: the client announces a minor and then has to LIVE with what came
    /// back. `session-created` — the whole GT-D11 custody claim — is withheld
    /// below minor 9 silently, because withholding an event is not an error, so
    /// a service under our floor has to be refused at the handshake or it is
    /// never noticed at all.
    #[tokio::test]
    async fn a_service_below_our_protocol_floor_is_refused_at_the_handshake() {
        handshake_with(PROTOCOL_MAJOR, PROTOCOL_MINOR)
            .await
            .expect("a service serving exactly our floor is what we asked for");
        handshake_with(PROTOCOL_MAJOR, PROTOCOL_MINOR + 4)
            .await
            .expect("a NEWER service is fine — the answer is the server's ceiling, not a contract");

        let refused = handshake_with(PROTOCOL_MAJOR, PROTOCOL_MINOR - 1)
            .await
            .expect_err("one minor below the floor still cannot push session-created");
        let refused = format!("{refused:#}");
        assert!(
            refused.contains(&format!("{PROTOCOL_MAJOR}.{PROTOCOL_MINOR} is required")),
            "the refusal names the floor it needs: {refused}"
        );

        handshake_with(PROTOCOL_MAJOR + 1, PROTOCOL_MINOR)
            .await
            .expect_err("and the major check it sits beside still stands");
    }
}
