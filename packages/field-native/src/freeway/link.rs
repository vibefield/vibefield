//! FW (v0.3 §5, §6) — one admitted link, run. The mux reads the peer's frames, the writer orders
//! this side's, and between them:
//! - stream 0, the link's own: a `Ping` is answered by a `Pong` carrying every byte received so
//!   far (the peer's writer counts its bytes in flight until acknowledged), with an `Ack` every
//!   `FREEWAY.ACK_EVERY_BYTES` between; the peer's `Pong` and `Ack` lower this side's in-flight;
//!   `Priority` moves a stream between classes. Three heartbeats with no pong is dead.
//! - a phone's approval: `Renew` is checked as the hello's was (the same node and login) and
//!   answered `Renewed` or `FreewayRefused`. A link whose approval lapses keeps its open streams
//!   and opens no new ones until renewed (§4.4).
//! - `terminal-tickets` and `terminal-renew`, answered from the phone's keyring, then CLOSE 1000
//!   (an approval-only kind on a desktop link is refused 4401).
//! - `terminal-leg`, dialed to the cell's loopback door (no Origin, as the sidecar dials it) and
//!   spliced both ways verbatim, each leg's close code carried back as its stream's CLOSE: the
//!   cell sees a loopback client, and the routed client reads a stream's end as a socket's. A
//!   door that does not answer within TPv3's hello deadline is OPEN_REFUSED 4504 `DOOR_DOWN`: the
//!   cell is gone, and the session's next ticket names its door. With `exposure.terminals` off,
//!   no terminal kind is served (4404).

use super::approval::{self, ApprovalKey};
use super::door::Ws;
use super::frame::{encode, Frame, FrameType, Message};
use super::hello::{check_approval, Admitted, Identity};
use super::keyring::{Keyring, Placement};
use super::mux::{Event, Mux, MuxError, Role, StreamSpec};
use super::writer::{Class, Writer};
use crate::registries::{freeway as limits, freeway_codes as codes, terminal_pipeline as tp};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message as WsMessage;

const NOT_SERVED: &str = "this desktop does not serve that kind";
const NOT_EXPOSED: &str = "terminals are not exposed off-device";

/// What a link reads of the floor's word: stdin line 1, as its later lines replace it (§5.2).
pub struct FloorState {
    /// The cells and sessions this desktop serves, for tickets and legs.
    pub placement: Placement,
    /// `declaration.exposure.terminals`: off, no link is served a terminal kind.
    pub terminals: bool,
    /// The floor's freeway key, which a phone's approval verifies with: at its hello, and at
    /// every `Renew`.
    pub approval_key: ApprovalKey,
}

/// Why a link ended.
#[derive(Debug, PartialEq, Eq)]
pub enum LinkEnd {
    /// The peer closed it, or its socket went.
    Closed,
    /// No pong for three heartbeats.
    Dead,
    /// This side closed it with a link code (4400 for a framing error).
    Refused(u16),
}

/// A `FreewayOpen` this host serves, read.
enum Open {
    Leg { cell: String, control: bool },
    Keyring(Request),
}

/// What a phone asks of its keyring.
enum Request {
    Tickets(Vec<String>),
    Renew {
        session: String,
        expect: u64,
        request: String,
    },
}

impl Open {
    fn read(payload: &[u8]) -> Option<Self> {
        let open: Value = serde_json::from_slice(payload).ok()?;
        let text = |field: &str| {
            let value = open.get(field)?.as_str()?;
            (!value.is_empty()).then(|| value.to_owned())
        };
        match open.get("kind")?.as_str()? {
            "terminal-leg" => Some(Self::Leg {
                cell: text("cellBootId")?,
                control: match open.get("channel")?.as_str()? {
                    "control" => true,
                    "frames" => false,
                    _ => return None,
                },
            }),
            "terminal-tickets" => {
                let ids = open.get("sessionIds")?.as_array()?;
                if ids.is_empty() || ids.len() > limits::MAX_TICKETS_PER_ASK as usize {
                    return None;
                }
                let ids = ids.iter().map(|id| {
                    let id = id.as_str()?;
                    (!id.is_empty()).then(|| id.to_owned())
                });
                Some(Self::Keyring(Request::Tickets(ids.collect::<Option<_>>()?)))
            }
            "terminal-renew" => Some(Self::Keyring(Request::Renew {
                session: text("sessionId")?,
                expect: open.get("expectGeneration")?.as_u64()?,
                request: text("requestId")?,
            })),
            _ => None,
        }
    }
}

/// What the mux makes of a stream this host serves — none while terminals are not exposed. None
/// is windowed (a terminal leg runs on TPv3's credits; tickets and renewals are one request and
/// one answer, P0), and a peer's message on one is bounded by what the cell's doors take from a
/// client (`tp/door.rs` `ws_config`): the link adds no limit of its own (§5.1).
fn spec(payload: &[u8], terminals: bool) -> Option<StreamSpec> {
    (terminals && Open::read(payload).is_some()).then_some(StreamSpec {
        windowed: false,
        message_bound: tp::MAX_CONTROL_MESSAGE_BYTES as usize,
    })
}

/// What a leg's task tells the link.
enum Leg {
    Up(u64),
    DoorDown(u64),
    FromCell(u64, WsMessage),
    Closed(u64, u16, String),
}

struct Link {
    mux: Mux,
    writer: Writer,
    identity: Identity,
    /// A phone's: its tickets' minter. A desktop link mints none.
    keyring: Option<Keyring>,
    approval_expires_at: Option<u64>,
    floor: Arc<Mutex<FloorState>>,
    legs: HashMap<u64, mpsc::UnboundedSender<WsMessage>>,
    leg_events: mpsc::UnboundedSender<Leg>,
    /// Every byte of the peer's frames, and the count this side last acknowledged.
    received: u64,
    acknowledged: u64,
    missed: u64,
    seq: u64,
    now: fn() -> u64,
}

/// Run one admitted link until it ends.
pub async fn run(
    ws: Ws,
    admitted: Admitted,
    floor: Arc<Mutex<FloorState>>,
    now: fn() -> u64,
) -> LinkEnd {
    let (mut sink, mut source) = ws.split();
    let (leg_events, mut legs_in) = mpsc::unbounded_channel();
    let keyring =
        (admitted.client_id.clone()).map(|client| Keyring::new(client, admitted.rights.clone()));
    let mut link = Link {
        mux: Mux::new(Role::Acceptor),
        writer: Writer::new(),
        identity: admitted.identity.clone(),
        keyring,
        approval_expires_at: admitted.approval_expires_at,
        floor,
        legs: HashMap::new(),
        leg_events,
        received: 0,
        acknowledged: 0,
        missed: 0,
        seq: 0,
        now,
    };
    let mut heartbeat = tokio::time::interval(Duration::from_millis(limits::HEARTBEAT_MS));
    heartbeat.tick().await;
    let end = loop {
        while let Some(frame) = link.writer.next_frame() {
            if sink.send(WsMessage::Binary(frame.into())).await.is_err() {
                return LinkEnd::Closed;
            }
        }
        tokio::select! {
            inbound = source.next() => match inbound {
                Some(Ok(WsMessage::Binary(bytes))) => {
                    link.received += bytes.len() as u64;
                    if let Err(code) = link.on_frame(&bytes) {
                        break LinkEnd::Refused(code);
                    }
                    link.acknowledge();
                }
                Some(Ok(WsMessage::Text(_))) => break LinkEnd::Refused(codes::PROTOCOL),
                Some(Ok(WsMessage::Ping(_) | WsMessage::Pong(_) | WsMessage::Frame(_))) => {}
                Some(Ok(WsMessage::Close(_))) | Some(Err(_)) | None => break LinkEnd::Closed,
            },
            Some(event) = legs_in.recv() => link.on_leg(event),
            _ = heartbeat.tick() => {
                if link.missed >= limits::MISSED_PINGS {
                    break LinkEnd::Dead;
                }
                link.ping();
            }
        }
    };
    if let LinkEnd::Refused(code) = end {
        let frame = CloseFrame {
            code: CloseCode::from(code),
            reason: "PROTOCOL".into(),
        };
        let _ = sink.send(WsMessage::Close(Some(frame))).await;
    }
    end
}

impl Link {
    fn link_message(&mut self, message: &Value) {
        let Ok(payload) = serde_json::to_vec(message) else {
            return;
        };
        let frame = Frame {
            kind: FrameType::Link,
            fragment: false,
            stream: 0,
            payload: &payload,
        };
        if let Ok(frame) = encode(&frame) {
            self.writer.queue_link(frame);
        }
    }

    fn ping(&mut self) {
        self.missed += 1;
        self.seq += 1;
        let ping = json!({ "type": "Ping", "seq": self.seq, "sentAtMs": (self.now)() });
        self.link_message(&ping);
    }

    /// An `Ack` once `FREEWAY.ACK_EVERY_BYTES` have come since the last acknowledgment.
    fn acknowledge(&mut self) {
        if self.received - self.acknowledged >= limits::ACK_EVERY_BYTES {
            self.acknowledged = self.received;
            let ack = json!({ "type": "Ack", "bytes": self.received });
            self.link_message(&ack);
        }
    }

    /// One frame from the peer; `Err` is the link's close code.
    fn on_frame(&mut self, bytes: &[u8]) -> Result<(), u16> {
        let terminals = self.floor.lock().unwrap().terminals;
        match self.mux.receive(bytes, |open| spec(open, terminals)) {
            Ok(event) => {
                self.on_event(event);
                Ok(())
            }
            // A message past its stream's bound closes that stream, and its leg, never the link.
            Err(MuxError::Message { stream, .. }) => {
                if let Some(leg) = self.legs.remove(&stream) {
                    let _ = leg.send(close_message(1009, ""));
                }
                self.end_stream(stream, 1009, "the message is past its stream's bound");
                Ok(())
            }
            Err(_) => Err(codes::PROTOCOL),
        }
    }

    fn on_event(&mut self, event: Event<'_>) {
        match event {
            Event::Link(payload) => self.on_link(payload),
            Event::Opened { stream, open, .. } => self.on_open(stream, open),
            Event::NotServed { stream, open } => {
                let terminal = (Open::read(open)).is_some();
                let state = if terminal { NOT_EXPOSED } else { NOT_SERVED };
                self.refuse(stream, codes::KIND_NOT_SERVED, state, false);
            }
            Event::Message { stream, message } => {
                if let Some(leg) = self.legs.get(&stream) {
                    let _ = leg.send(match message {
                        Message::Text(text) => WsMessage::Text(text.into()),
                        Message::Binary(bytes) => WsMessage::Binary(bytes.into()),
                    });
                }
            }
            // The peer answered this side's CLOSE: the stream is gone.
            Event::Closed {
                answer_owed: false, ..
            } => {}
            Event::Closed { stream, close, .. } => {
                let close: Value = serde_json::from_slice(close).unwrap_or(Value::Null);
                let code = (close["code"].as_u64())
                    .and_then(|code| u16::try_from(code).ok())
                    .unwrap_or(1000);
                let reason = close["reason"].as_str().unwrap_or("");
                match self.legs.get(&stream) {
                    // The cell answers first; its answer comes back as this side's CLOSE.
                    Some(leg) => {
                        let _ = leg.send(close_message(code, reason));
                    }
                    None => self.end_stream(stream, code, reason),
                }
            }
            Event::Window { stream, bytes } => self.writer.grant(stream, bytes),
            Event::Answered { .. }
            | Event::Refused { .. }
            | Event::Pending { .. }
            | Event::Late { .. } => {}
        }
    }

    fn on_link(&mut self, payload: &[u8]) {
        let Ok(message) = serde_json::from_slice::<Value>(payload) else {
            return;
        };
        match message.get("type").and_then(Value::as_str) {
            Some("Ping") => {
                self.acknowledged = self.received;
                let pong = json!({
                    "type": "Pong",
                    "seq": message["seq"],
                    "sentAtMs": message["sentAtMs"],
                    "ackBytes": self.received,
                });
                self.link_message(&pong);
            }
            Some("Pong") => {
                self.missed = 0;
                if let Some(bytes) = message["ackBytes"].as_u64() {
                    self.writer.acked(bytes);
                }
            }
            Some("Ack") => {
                if let Some(bytes) = message["bytes"].as_u64() {
                    self.writer.acked(bytes);
                }
            }
            Some("Priority") => {
                let class = match message["class"].as_str() {
                    Some("urgent") => Class::Urgent,
                    Some("live") => Class::Live,
                    Some("sync") => Class::Sync,
                    Some("bulk") => Class::Bulk,
                    _ => return,
                };
                if let Some(stream) = message["streamId"].as_u64() {
                    self.writer.reclass(stream, class);
                }
            }
            Some("Renew") => self.renew(&message["approval"]),
            _ => {}
        }
    }

    /// A phone's `Renew`: checked as its hello was, then the link's approval, and its next mints'
    /// rights, are the new one's. A desktop link carries no approval; its `Renew` is not read.
    fn renew(&mut self, approval: &Value) {
        let Some(keyring) = self.keyring.as_mut() else {
            return;
        };
        let now = (self.now)();
        let checked = {
            let floor = self.floor.lock().unwrap();
            check_approval(approval, &self.identity, &floor.approval_key, now)
        };
        let answer = match checked {
            Ok(claims) => {
                self.approval_expires_at = Some(claims.expires_at);
                keyring.set_rights(claims.rights);
                json!({ "type": "Renewed", "approvalExpiresAt": claims.expires_at })
            }
            Err(refused) => refused.payload(),
        };
        self.link_message(&answer);
    }

    fn on_open(&mut self, stream: u64, payload: &[u8]) {
        let Some(open) = Open::read(payload) else {
            return self.refuse(stream, codes::KIND_NOT_SERVED, NOT_SERVED, false);
        };
        let now = (self.now)();
        if (self.approval_expires_at).is_some_and(|at| approval::lapsed(at, now)) {
            return self.refuse(
                stream,
                codes::APPROVAL,
                "the approval lapsed; renew it",
                true,
            );
        }
        match open {
            Open::Leg { cell, control } => self.dial_leg(stream, &cell, control),
            Open::Keyring(request) => self.answer(stream, request, now),
        }
    }

    /// A keyring request: OPENED with the keyring's answer, then CLOSE 1000.
    fn answer(&mut self, stream: u64, request: Request, now: u64) {
        let Some(keyring) = self.keyring.as_mut() else {
            let state = "an approval-only kind on a desktop link";
            return self.refuse(stream, codes::APPROVAL, state, false);
        };
        let floor = self.floor.lock().unwrap();
        let answer = match request {
            Request::Tickets(ids) => keyring.tickets(&ids, &floor.placement, now),
            Request::Renew {
                session,
                expect,
                request,
            } => keyring.renew(&session, expect, &request, &floor.placement, now),
        };
        drop(floor);
        self.writer.open(stream, Class::Urgent, false);
        self.queue_json(stream, FrameType::Opened, &answer);
        self.end_stream(stream, 1000, "");
    }

    fn dial_leg(&mut self, stream: u64, cell: &str, control: bool) {
        let url = {
            let floor = self.floor.lock().unwrap();
            let route = floor.placement.cells.get(cell);
            route.map(|route| match control {
                true => route.control_url.clone(),
                false => route.frames_url.clone(),
            })
        };
        let Some(url) = url else {
            let state = "the terminal is not on this desktop";
            return self.refuse(stream, codes::DOOR_DOWN, state, false);
        };
        // The control leg is P0; a frames leg rides `live` until the phone's `Priority` says
        // which cell is focused (v0.3 §5's table).
        let class = if control { Class::Urgent } else { Class::Live };
        self.writer.open(stream, class, false);
        let (to_cell, from_link) = mpsc::unbounded_channel();
        self.legs.insert(stream, to_cell);
        tokio::spawn(leg(stream, url, from_link, self.leg_events.clone()));
    }

    fn on_leg(&mut self, event: Leg) {
        match event {
            Leg::Up(stream) => self.queue_json(stream, FrameType::Opened, &json!({})),
            Leg::DoorDown(stream) => {
                self.legs.remove(&stream);
                let state = "the terminal's door did not answer";
                self.refuse(stream, codes::DOOR_DOWN, state, false);
            }
            Leg::FromCell(stream, message) if self.legs.contains_key(&stream) => match message {
                WsMessage::Text(text) => {
                    self.writer
                        .queue(stream, FrameType::Text, text.as_bytes().to_vec());
                }
                WsMessage::Binary(bytes) => {
                    self.writer.queue(stream, FrameType::Binary, bytes.to_vec());
                }
                _ => {}
            },
            Leg::FromCell(..) => {}
            // A leg this side already ended (its message overran) has had its CLOSE.
            Leg::Closed(stream, code, reason) => {
                if self.legs.remove(&stream).is_some() {
                    self.end_stream(stream, code, &reason);
                }
            }
        }
    }

    /// This side's CLOSE of a stream, behind whatever it already queued there.
    fn end_stream(&mut self, stream: u64, code: u16, reason: &str) {
        let close = match reason {
            "" => json!({ "code": code }),
            reason => json!({ "code": code, "reason": reason }),
        };
        self.queue_json(stream, FrameType::Close, &close);
        self.mux.close(stream);
    }

    /// OPEN_REFUSED: the host's own refusal of an open, in a link code. The stream is gone.
    fn refuse(&mut self, stream: u64, code: u16, state: &str, retryable: bool) {
        self.mux.forget(stream);
        self.writer.forget(stream);
        self.writer.open(stream, Class::Urgent, false);
        let refusal = json!({ "code": code, "state": state, "retryable": retryable });
        self.queue_json(stream, FrameType::OpenRefused, &refusal);
    }

    fn queue_json(&mut self, stream: u64, kind: FrameType, payload: &Value) {
        if let Ok(bytes) = serde_json::to_vec(payload) {
            self.writer.queue(stream, kind, bytes);
        }
    }
}

fn close_message(code: u16, reason: &str) -> WsMessage {
    WsMessage::Close(Some(CloseFrame {
        code: CloseCode::from(code),
        reason: reason.to_owned().into(),
    }))
}

/// One leg: dial the cell's door, then splice both ways until either side closes, or the link
/// goes (and its leg with it).
async fn leg(
    stream: u64,
    url: String,
    mut to_cell: mpsc::UnboundedReceiver<WsMessage>,
    events: mpsc::UnboundedSender<Leg>,
) {
    let deadline = Duration::from_millis(tp::HELLO_DEADLINE_MS);
    let dial = tokio::time::timeout(deadline, tokio_tungstenite::connect_async(url.as_str()));
    let Ok(Ok((cell, _))) = dial.await else {
        let _ = events.send(Leg::DoorDown(stream));
        return;
    };
    let _ = events.send(Leg::Up(stream));
    let (mut sink, mut source) = cell.split();
    loop {
        tokio::select! {
            outbound = to_cell.recv() => match outbound {
                Some(message) => {
                    if sink.send(message).await.is_err() {
                        let _ = events.send(Leg::Closed(stream, 1006, String::new()));
                        return;
                    }
                }
                None => {
                    let _ = sink.send(close_message(1001, "")).await;
                    return;
                }
            },
            inbound = source.next() => match inbound {
                Some(Ok(message @ (WsMessage::Text(_) | WsMessage::Binary(_)))) => {
                    let _ = events.send(Leg::FromCell(stream, message));
                }
                Some(Ok(WsMessage::Close(frame))) => {
                    let (code, reason) = frame
                        .map(|frame| (u16::from(frame.code), frame.reason.to_string()))
                        .unwrap_or((1005, String::new()));
                    // The close reply the socket queued goes out before it does.
                    let _ = sink.close().await;
                    let _ = events.send(Leg::Closed(stream, code, reason));
                    return;
                }
                Some(Ok(_)) => {}
                Some(Err(_)) | None => {
                    let _ = events.send(Leg::Closed(stream, 1006, String::new()));
                    return;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::door::{accept, DoorConfig};
    use super::super::frame::decode;
    use super::super::hello::{decide, Admit, Host, PeerRole};
    use super::super::keyring::{CellRoute, SessionRoute};
    use super::*;
    use crate::tp::grant::GrantKey;
    use crate::tp::jcs::canonical_json;
    use data_encoding::BASE64URL_NOPAD;
    use hmac::{Hmac, KeyInit, Mac};
    use sha2::Sha256;
    use std::sync::atomic::{AtomicU64, Ordering};
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    type Client = tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >;

    /// The approval vector's floor, node and login (`freeway-approval-mac.vector.json`).
    const FLOOR_BOOT: &str = "fb-0191b04e-2026";
    const NODE: &str = "nKMWkU9CYk11CNTRL";
    const LOGIN: &str = "person@example.com";
    const ISSUED: u64 = 1_787_788_800_000;

    fn fixed() -> u64 {
        ISSUED + 1_000
    }

    fn json_of(bytes: &[u8]) -> Value {
        serde_json::from_slice(bytes).unwrap()
    }

    fn approval_key() -> ApprovalKey {
        ApprovalKey {
            floor_boot_id: FLOOR_BOOT.into(),
            key_generation: 1,
            key: vec![0xa5; 32],
        }
    }

    fn approval(issued: u64) -> Value {
        approval_for(NODE, issued)
    }

    /// The vector's approval for `node`, issued at `issued`, signed with the floor's key as
    /// fieldd signs.
    fn approval_for(node: &str, issued: u64) -> Value {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures/freeway-approval-mac.vector.json");
        let v: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let protected = v["approval"]["protected"].clone();
        let mut claims = v["approval"]["claims"].clone();
        claims["issuedAt"] = json!(issued);
        claims["expiresAt"] = json!(issued + limits::APPROVAL_TTL_MS);
        claims["principal"]["tailscaleId"] = json!(node);
        let input = canonical_json(&json!({ "protected": protected, "claims": claims })).unwrap();
        let mut mac = Hmac::<Sha256>::new_from_slice(&[0xa5; 32]).unwrap();
        mac.update(input.as_bytes());
        let mac = BASE64URL_NOPAD.encode(&mac.finalize().into_bytes());
        json!({ "protected": protected, "claims": claims, "mac": mac })
    }

    fn floor(cell: &str, terminals: bool) -> Arc<Mutex<FloorState>> {
        let mut placement = Placement::default();
        placement.cells.insert(
            "cb-1".into(),
            CellRoute {
                key: GrantKey {
                    cell_boot_id: "cb-1".into(),
                    key_generation: 1,
                    key: vec![7; 32],
                },
                route_revision: 1,
                control_url: format!("{cell}/control"),
                frames_url: format!("{cell}/frames"),
            },
        );
        placement.sessions.insert(
            "sess-a".into(),
            SessionRoute {
                cell_boot_id: "cb-1".into(),
                lease_epoch: None,
            },
        );
        Arc::new(Mutex::new(FloorState {
            placement,
            terminals,
            approval_key: approval_key(),
        }))
    }

    /// A cell's door, faked: it echoes every message, closes with 4003 when told "bye", and
    /// answers a close with its own code (tungstenite's reply, which its next read flushes). Each
    /// connection's end is reported, with the close code it was sent, if any.
    async fn fake_cell() -> (String, mpsc::UnboundedReceiver<Option<u16>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (ends, ended) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let ends = ends.clone();
                tokio::spawn(async move {
                    let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                    let mut sent = None;
                    while let Some(Ok(message)) = ws.next().await {
                        match message {
                            WsMessage::Text(ref text) if text.as_str() == "bye" => {
                                let frame = CloseFrame {
                                    code: CloseCode::from(4003),
                                    reason: "REVOKED".into(),
                                };
                                let _ = ws.close(Some(frame)).await;
                            }
                            WsMessage::Text(_) | WsMessage::Binary(_) => {
                                let _ = ws.send(message).await;
                            }
                            WsMessage::Close(frame) => sent = frame.map(|f| u16::from(f.code)),
                            _ => {}
                        }
                    }
                    let _ = ends.send(sent);
                });
            }
        });
        (format!("ws://127.0.0.1:{port}"), ended)
    }

    /// A host serving one link on a loopback port; the vector's node is admitted as `role`.
    async fn host_on(role: PeerRole, floor: Arc<Mutex<FloorState>>, now: fn() -> u64) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut admit = Admit::default();
            admit.insert(NODE, "dev-b", role);
            let key = approval_key();
            let host = Host {
                link_id: "lk-1",
                host_boot_id: "hb-1",
                floor_boot_id: FLOOR_BOOT,
                device_id: "dev-a",
            };
            let config = DoorConfig::new("s3cret".into());
            let decided = |payload: &[u8], identity: &Identity| {
                decide(payload, identity, &admit, &key, &host, now())
            };
            if let Some((ws, admitted)) = accept(stream, &config, decided).await {
                run(ws, admitted, floor, now).await;
            }
        });
        port
    }

    /// Dial the host as the vector's node, say `hello`, and read the welcome.
    async fn dial(port: u16, hello: Value) -> Client {
        let url = format!("ws://127.0.0.1:{port}/f/s3cret");
        let mut request = url.into_client_request().unwrap();
        let headers = request.headers_mut();
        headers.insert("tailscale-user-login", LOGIN.parse().unwrap());
        headers.insert("tailscale-node-id", NODE.parse().unwrap());
        let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
        send(&mut ws, FrameType::Link, 0, hello.to_string().as_bytes()).await;
        let (kind, stream, welcome) = next(&mut ws).await;
        assert_eq!((kind, stream), (FrameType::Link, 0));
        assert_eq!(json_of(&welcome)["type"], "FreewayWelcome");
        ws
    }

    fn desktop_hello() -> Value {
        json!({ "type": "FreewayPeerHello", "protocol": { "major": 1, "minor": 0 } })
    }

    fn phone_hello() -> Value {
        let protocol = json!({ "major": 1, "minor": 0 });
        json!({ "type": "FreewayHello", "protocol": protocol, "approval": approval(ISSUED) })
    }

    async fn send(ws: &mut Client, kind: FrameType, stream: u64, payload: &[u8]) {
        let frame = Frame {
            kind,
            fragment: false,
            stream,
            payload,
        };
        let frame = encode(&frame).unwrap();
        ws.send(WsMessage::Binary(frame.into())).await.unwrap();
    }

    /// The next frame, as (kind, stream, payload) — past the host's own heartbeat, which may come
    /// at any 2 s and is never the frame a row waits for.
    async fn next(ws: &mut Client) -> (FrameType, u64, Vec<u8>) {
        loop {
            let message = tokio::time::timeout(Duration::from_secs(5), ws.next());
            let message = message.await.expect("a frame").unwrap().unwrap();
            let WsMessage::Binary(bytes) = message else {
                continue;
            };
            let frame = decode(&bytes).unwrap();
            if frame.kind == FrameType::Link && json_of(frame.payload)["type"] == "Ping" {
                continue;
            }
            return (frame.kind, frame.stream, frame.payload.to_vec());
        }
    }

    async fn ping_is_next(ws: &mut Client) {
        send(
            ws,
            FrameType::Link,
            0,
            br#"{"type":"Ping","seq":1,"sentAtMs":5}"#,
        )
        .await;
        let (kind, stream, pong) = next(ws).await;
        assert_eq!((kind, stream), (FrameType::Link, 0));
        assert_eq!(json_of(&pong)["type"], "Pong");
    }

    #[tokio::test]
    async fn a_leg_is_spliced_to_its_cell_and_each_close_is_answered_once() {
        let (cell, _) = fake_cell().await;
        let port = host_on(PeerRole::Desktop, floor(&cell, true), fixed).await;
        let mut ws = dial(port, desktop_hello()).await;
        let leg = br#"{"kind":"terminal-leg","cellBootId":"cb-1","channel":"control"}"#;
        send(&mut ws, FrameType::Open, 1, leg).await;
        // Optimistic: the routed hello rides right behind the open, before the leg is up.
        send(&mut ws, FrameType::Text, 1, b"ConnectionHello").await;
        assert_eq!(next(&mut ws).await, (FrameType::Opened, 1, b"{}".to_vec()));
        let hello = (FrameType::Text, 1, b"ConnectionHello".to_vec());
        assert_eq!(next(&mut ws).await, hello);
        send(&mut ws, FrameType::Binary, 1, &[1, 2, 3]).await;
        assert_eq!(next(&mut ws).await, (FrameType::Binary, 1, vec![1, 2, 3]));
        // The peer closes: the cell answers, and its answer is the stream's, verbatim.
        let timeout = br#"{"code":4004,"reason":"LEG_TIMEOUT"}"#;
        send(&mut ws, FrameType::Close, 1, timeout).await;
        let (kind, stream, close) = next(&mut ws).await;
        assert_eq!((kind, stream), (FrameType::Close, 1));
        assert_eq!(
            json_of(&close),
            json!({ "code": 4004, "reason": "LEG_TIMEOUT" })
        );

        // The cell closes: its code is the stream's CLOSE, and the peer's answer gets no other.
        send(&mut ws, FrameType::Open, 3, leg).await;
        assert_eq!(next(&mut ws).await, (FrameType::Opened, 3, b"{}".to_vec()));
        send(&mut ws, FrameType::Text, 3, b"bye").await;
        let (kind, stream, close) = next(&mut ws).await;
        assert_eq!((kind, stream), (FrameType::Close, 3));
        assert_eq!(
            json_of(&close),
            json!({ "code": 4003, "reason": "REVOKED" })
        );
        send(&mut ws, FrameType::Close, 3, br#"{"code":4003}"#).await;
        ping_is_next(&mut ws).await;

        // A message past what the cell's door takes closes that stream (1009), never the link.
        send(&mut ws, FrameType::Open, 5, leg).await;
        assert_eq!(next(&mut ws).await, (FrameType::Opened, 5, b"{}".to_vec()));
        let big = vec![0; tp::MAX_CONTROL_MESSAGE_BYTES as usize + 1];
        send(&mut ws, FrameType::Binary, 5, &big).await;
        // It crossed ACK_EVERY_BYTES: stream 0's Ack drains ahead of every stream's frames.
        let (kind, stream, ack) = next(&mut ws).await;
        assert_eq!(
            (kind, stream, json_of(&ack)["type"].clone()),
            (FrameType::Link, 0, json!("Ack"))
        );
        let (kind, stream, close) = next(&mut ws).await;
        assert_eq!(
            (kind, stream, json_of(&close)["code"].clone()),
            (FrameType::Close, 5, json!(1009))
        );
        send(&mut ws, FrameType::Close, 5, br#"{"code":1009}"#).await;
        ping_is_next(&mut ws).await;
    }

    #[tokio::test]
    async fn a_leg_goes_with_its_link() {
        let (cell, mut ended) = fake_cell().await;
        let port = host_on(PeerRole::Desktop, floor(&cell, true), fixed).await;
        let mut ws = dial(port, desktop_hello()).await;
        let leg = br#"{"kind":"terminal-leg","cellBootId":"cb-1","channel":"frames"}"#;
        send(&mut ws, FrameType::Open, 1, leg).await;
        assert_eq!(next(&mut ws).await, (FrameType::Opened, 1, b"{}".to_vec()));
        drop(ws);
        let end = tokio::time::timeout(Duration::from_secs(5), ended.recv());
        assert_eq!(end.await.expect("the leg's end"), Some(Some(1001)));
    }

    #[tokio::test]
    async fn the_link_acks_what_it_received_and_refuses_what_it_cannot_serve() {
        let port = host_on(PeerRole::Desktop, floor("ws://127.0.0.1:1", true), fixed).await;
        let mut ws = dial(port, desktop_hello()).await;
        send(
            &mut ws,
            FrameType::Link,
            0,
            br#"{"type":"Ping","seq":7,"sentAtMs":5}"#,
        )
        .await;
        let (_, _, pong) = next(&mut ws).await;
        let pong = json_of(&pong);
        assert_eq!((&pong["type"], &pong["seq"]), (&json!("Pong"), &json!(7)));
        let received = pong["ackBytes"].as_u64().unwrap();
        assert!(received > 0);
        // Between pongs, an Ack every ACK_EVERY_BYTES.
        let pad = "x".repeat(limits::ACK_EVERY_BYTES as usize);
        let padded = json!({ "type": "Ack", "bytes": 0, "pad": pad }).to_string();
        send(&mut ws, FrameType::Link, 0, padded.as_bytes()).await;
        let (_, _, ack) = next(&mut ws).await;
        let ack = json_of(&ack);
        assert_eq!(ack["type"], "Ack");
        assert!(ack["bytes"].as_u64().unwrap() >= received + limits::ACK_EVERY_BYTES);

        let refusal = |payload: &[u8]| json_of(payload)["code"].as_u64().unwrap();
        let frames = br#"{"kind":"terminal-leg","cellBootId":"cb-1","channel":"frames"}"#;
        send(&mut ws, FrameType::Open, 1, frames).await;
        let (kind, stream, refused) = next(&mut ws).await;
        assert_eq!((kind, stream), (FrameType::OpenRefused, 1));
        assert_eq!(refusal(&refused), u64::from(codes::DOOR_DOWN));
        let gone = br#"{"kind":"terminal-leg","cellBootId":"cb-gone","channel":"frames"}"#;
        send(&mut ws, FrameType::Open, 3, gone).await;
        let (kind, _, refused) = next(&mut ws).await;
        assert_eq!(kind, FrameType::OpenRefused);
        assert_eq!(refusal(&refused), u64::from(codes::DOOR_DOWN));
        // A desktop link has no keyring: tickets are an approval-only kind.
        let tickets = br#"{"kind":"terminal-tickets","sessionIds":["sess-a"]}"#;
        send(&mut ws, FrameType::Open, 5, tickets).await;
        let (kind, _, refused) = next(&mut ws).await;
        assert_eq!(kind, FrameType::OpenRefused);
        assert_eq!(refusal(&refused), u64::from(codes::APPROVAL));
        let unknown = br#"{"kind":"files"}"#;
        send(&mut ws, FrameType::Open, 7, unknown).await;
        let (kind, _, refused) = next(&mut ws).await;
        assert_eq!(kind, FrameType::OpenRefused);
        assert_eq!(json_of(&refused)["state"], NOT_SERVED);

        // With terminals not exposed, no terminal kind is served at all.
        let hidden = host_on(PeerRole::Desktop, floor("ws://127.0.0.1:1", false), fixed).await;
        let mut ws = dial(hidden, desktop_hello()).await;
        send(&mut ws, FrameType::Open, 1, frames).await;
        let (kind, _, refused) = next(&mut ws).await;
        assert_eq!(kind, FrameType::OpenRefused);
        assert_eq!(refusal(&refused), u64::from(codes::KIND_NOT_SERVED));
        assert_eq!(json_of(&refused)["state"], NOT_EXPOSED);
    }

    #[tokio::test]
    async fn a_phone_mints_from_its_keyring_and_once_its_approval_lapses_opens_nothing_until_renewed(
    ) {
        static CLOCK: AtomicU64 = AtomicU64::new(ISSUED + 1_000);
        fn now() -> u64 {
            CLOCK.load(Ordering::SeqCst)
        }
        let port = host_on(PeerRole::Phone, floor("ws://127.0.0.1:1", true), now).await;
        let mut ws = dial(port, phone_hello()).await;
        let tickets = br#"{"kind":"terminal-tickets","sessionIds":["sess-a"]}"#;
        send(&mut ws, FrameType::Open, 1, tickets).await;
        let (kind, stream, opened) = next(&mut ws).await;
        assert_eq!((kind, stream), (FrameType::Opened, 1));
        let ticket = &json_of(&opened)["tickets"][0]["ticket"];
        let client = format!("freeway:{LOGIN}#{NODE}~hb-1");
        assert_eq!(ticket["attachGrant"]["claims"]["clientId"], json!(client));
        assert_eq!(
            ticket["endpoints"]["controlUrl"],
            "freeway://cell/cb-1/control"
        );
        let (kind, stream, close) = next(&mut ws).await;
        assert_eq!(
            (kind, stream, json_of(&close)),
            (FrameType::Close, 1, json!({ "code": 1000 }))
        );
        send(&mut ws, FrameType::Close, 1, br#"{"code":1000}"#).await;

        // The approval lapses: the link stands, and opens nothing new.
        let lapse = ISSUED + limits::APPROVAL_TTL_MS + tp::MAX_CLOCK_SKEW_MS;
        CLOCK.store(lapse, Ordering::SeqCst);
        send(&mut ws, FrameType::Open, 3, tickets).await;
        let (kind, _, refused) = next(&mut ws).await;
        assert_eq!(kind, FrameType::OpenRefused);
        let refused = json_of(&refused);
        assert_eq!(
            (&refused["code"], &refused["retryable"]),
            (&json!(codes::APPROVAL), &json!(true))
        );

        // Renewed with fieldd's next approval: opens are served again, on the same keyring.
        let renewal = approval(ISSUED + limits::APPROVAL_TTL_MS);
        let renew = json!({ "type": "Renew", "approval": renewal }).to_string();
        send(&mut ws, FrameType::Link, 0, renew.as_bytes()).await;
        let (_, _, renewed) = next(&mut ws).await;
        let expires = ISSUED + 2 * limits::APPROVAL_TTL_MS;
        assert_eq!(
            json_of(&renewed),
            json!({ "type": "Renewed", "approvalExpiresAt": expires })
        );
        let cas = br#"{"kind":"terminal-renew","sessionId":"sess-a","expectGeneration":1,"requestId":"rq-1"}"#;
        send(&mut ws, FrameType::Open, 5, cas).await;
        let (kind, stream, opened) = next(&mut ws).await;
        assert_eq!((kind, stream), (FrameType::Opened, 5));
        assert_eq!(
            json_of(&opened)["attachGrant"]["claims"]["grantGeneration"],
            2
        );
        let (kind, stream, close) = next(&mut ws).await;
        assert_eq!(
            (kind, stream, json_of(&close)),
            (FrameType::Close, 5, json!({ "code": 1000 }))
        );
        send(&mut ws, FrameType::Close, 5, br#"{"code":1000}"#).await;

        // fieldd's approval for another node, well signed, never renews this link.
        let other = approval_for("nOTHER", ISSUED + limits::APPROVAL_TTL_MS);
        let renew = json!({ "type": "Renew", "approval": other }).to_string();
        send(&mut ws, FrameType::Link, 0, renew.as_bytes()).await;
        let (kind, _, refused) = next(&mut ws).await;
        assert_eq!(kind, FrameType::Link);
        let refused = json_of(&refused);
        assert_eq!(
            (&refused["type"], &refused["code"]),
            (&json!("FreewayRefused"), &json!("IDENTITY_MISMATCH"))
        );
    }
}
