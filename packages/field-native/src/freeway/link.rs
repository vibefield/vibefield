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
//! - the host's word, as `LinkCommand`s: a newer link from the same node supersedes this one (4409),
//!   a revoke closes it (4410), a planned restart says `Restarting` first (4503).
//! - the audit (FW-L3): a session's first ticket on the link is its join, the link's end every
//!   join's leave, each reported as a line for the floor to carry to fieldd, the only writer.

use super::approval::{self, ApprovalKey};
use super::door::Ws;
use super::frame::{encode, Frame, FrameType, Message};
use super::hello::{check_approval, Admit, Admitted, Identity};
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
    /// Who may link: fieldd's admit rows joined with the floor's peer rows (node → device, role).
    pub admit: Admit,
    /// THIS desktop's roster device id, the welcome's (the declaration's; none until fieldd has
    /// declared, and then no node is admitted either).
    pub device_id: Option<String>,
}

/// What every link of this host shares: the floor's word, and each phone's keyring by client id.
/// A keyring's ledgers are the host BOOT's, as the client id is (`…~<hostBootId>`): a phone that
/// reconnects within one boot mints on from its own high-water instead of meeting it at the cell
/// (`GRANT_GENERATION_ROLLBACK`, not retryable — fieldd's TP-R21, `terminal-grants.ts`).
pub struct Shared {
    pub floor: FloorState,
    pub keyrings: HashMap<String, Keyring>,
}

/// What the host tells a running link.
#[derive(Debug, Clone, PartialEq)]
pub enum LinkCommand {
    /// Close it with this code: 4401 its approval was revoked (the phone asks fieldd for another,
    /// which fieldd decides), 4409 a newer link from its node took its place, 4410 its node left
    /// fieldd's admit set, 1001 the host is going.
    Close(u16),
    /// A planned restart: this `FreewayRestarting` first, then 4503.
    Restart(Value),
}

/// Why a link ended.
#[derive(Debug, PartialEq, Eq)]
pub enum LinkEnd {
    /// The peer closed it, or its socket went.
    Closed,
    /// No pong for three heartbeats.
    Dead,
    /// This side closed it with this code: 4400 for the peer's framing, or the host's word.
    Code(u16),
}

/// A close code's name, as the close frame's reason.
fn code_name(code: u16) -> &'static str {
    match code {
        codes::PROTOCOL => "PROTOCOL",
        codes::APPROVAL => "APPROVAL",
        codes::SUPERSEDED => "SUPERSEDED",
        codes::PEER_GONE => "PEER_GONE",
        codes::RESTARTING => "RESTARTING",
        _ => "",
    }
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
    /// A phone's client id: its keyring's key in `Shared`. A desktop link mints nothing.
    client: Option<String>,
    approval_expires_at: Option<u64>,
    shared: Arc<Mutex<Shared>>,
    legs: HashMap<u64, mpsc::UnboundedSender<WsMessage>>,
    leg_events: mpsc::UnboundedSender<Leg>,
    /// The host's stdout lines: this link's joins and leaves.
    reports: mpsc::UnboundedSender<Value>,
    /// Each session joined on this link, with the rights it joined with.
    joined: HashMap<String, Value>,
    /// Every byte of the peer's frames, and the count this side last acknowledged.
    received: u64,
    acknowledged: u64,
    missed: u64,
    seq: u64,
    now: fn() -> u64,
}

/// Run one admitted link until it ends: the host's word comes on `commands`, the link's joins
/// and leaves go out on `reports`.
pub async fn run(
    ws: Ws,
    admitted: Admitted,
    shared: Arc<Mutex<Shared>>,
    mut commands: mpsc::UnboundedReceiver<LinkCommand>,
    reports: mpsc::UnboundedSender<Value>,
    now: fn() -> u64,
) -> LinkEnd {
    let (mut sink, mut source) = ws.split();
    let (leg_events, mut legs_in) = mpsc::unbounded_channel();
    if let Some(client) = &admitted.client_id {
        let mut shared = shared.lock().unwrap();
        let keyring = (shared.keyrings.entry(client.clone()))
            .or_insert_with(|| Keyring::new(client.clone(), admitted.rights.clone()));
        keyring.set_rights(admitted.rights.clone());
        keyring.reopen();
    }
    let mut link = Link {
        mux: Mux::new(Role::Acceptor),
        writer: Writer::new(),
        identity: admitted.identity.clone(),
        client: admitted.client_id.clone(),
        approval_expires_at: admitted.approval_expires_at,
        shared,
        legs: HashMap::new(),
        leg_events,
        reports,
        joined: HashMap::new(),
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
                        break LinkEnd::Code(code);
                    }
                    link.acknowledge();
                }
                Some(Ok(WsMessage::Text(_))) => break LinkEnd::Code(codes::PROTOCOL),
                Some(Ok(WsMessage::Ping(_) | WsMessage::Pong(_) | WsMessage::Frame(_))) => {}
                Some(Ok(WsMessage::Close(_))) | Some(Err(_)) | None => break LinkEnd::Closed,
            },
            Some(event) = legs_in.recv() => link.on_leg(event),
            Some(command) = commands.recv() => match command {
                LinkCommand::Close(code) => break LinkEnd::Code(code),
                LinkCommand::Restart(restarting) => {
                    // Ahead of anything the writer still holds: the peer reads it before the close.
                    if let Some(frame) = link_frame(&restarting) {
                        let _ = sink.send(WsMessage::Binary(frame.into())).await;
                    }
                    break LinkEnd::Code(codes::RESTARTING);
                }
            },
            _ = heartbeat.tick() => {
                if link.missed >= limits::MISSED_PINGS {
                    break LinkEnd::Dead;
                }
                link.ping();
            }
        }
    };
    if let LinkEnd::Code(code) = end {
        let _ = sink.send(close_message(code, code_name(code))).await;
    }
    let now = (link.now)();
    for (session, rights) in std::mem::take(&mut link.joined) {
        link.report("left", &session, &rights, now);
    }
    end
}

/// A stream-0 message, framed.
fn link_frame(message: &Value) -> Option<Vec<u8>> {
    let payload = serde_json::to_vec(message).ok()?;
    let frame = Frame {
        kind: FrameType::Link,
        fragment: false,
        stream: 0,
        payload: &payload,
    };
    encode(&frame).ok()
}

impl Link {
    fn link_message(&mut self, message: &Value) {
        if let Some(frame) = link_frame(message) {
            self.writer.queue_link(frame);
        }
    }

    /// A session's first ticket on this link is its join; the link's end is every join's leave.
    fn join(&mut self, session: &str, rights: &Value, now: u64) {
        if self.joined.contains_key(session) {
            return;
        }
        self.joined.insert(session.to_owned(), rights.clone());
        self.report("joined", session, rights, now);
    }

    fn report(&self, kind: &str, session: &str, rights: &Value, at: u64) {
        let Some(client) = &self.client else {
            return;
        };
        let row = json!({ "clientId": client, "sessionId": session, "rights": rights, "at": at });
        let mut line = serde_json::Map::new();
        line.insert(kind.to_owned(), row);
        let _ = self.reports.send(Value::Object(line));
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
        let terminals = self.shared.lock().unwrap().floor.terminals;
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
        let Some(client) = &self.client else {
            return;
        };
        let now = (self.now)();
        let answer = {
            let mut shared = self.shared.lock().unwrap();
            let Shared { floor, keyrings } = &mut *shared;
            match check_approval(approval, &self.identity, &floor.approval_key, now) {
                Ok(claims) => {
                    self.approval_expires_at = Some(claims.expires_at);
                    if let Some(keyring) = keyrings.get_mut(client) {
                        keyring.set_rights(claims.rights);
                    }
                    json!({ "type": "Renewed", "approvalExpiresAt": claims.expires_at })
                }
                Err(refused) => refused.payload(),
            }
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
        let minted = self.client.as_ref().and_then(|client| {
            let mut shared = self.shared.lock().unwrap();
            let Shared { floor, keyrings } = &mut *shared;
            let keyring = keyrings.get_mut(client)?;
            let answer = match request {
                Request::Tickets(ids) => keyring.tickets(&ids, &floor.placement, now),
                Request::Renew {
                    session,
                    expect,
                    request,
                } => keyring.renew(&session, expect, &request, &floor.placement, now),
            };
            Some((answer, json!(keyring.rights())))
        });
        let Some((answer, rights)) = minted else {
            let state = "an approval-only kind on a desktop link";
            return self.refuse(stream, codes::APPROVAL, state, false);
        };
        let ticketed = (answer["tickets"].as_array().into_iter().flatten())
            .filter(|row| row.get("ticket").is_some())
            .filter_map(|row| row["sessionId"].as_str());
        for session in ticketed.map(str::to_owned).collect::<Vec<_>>() {
            self.join(&session, &rights, now);
        }
        self.writer.open(stream, Class::Urgent, false);
        self.queue_json(stream, FrameType::Opened, &answer);
        self.end_stream(stream, 1000, "");
    }

    fn dial_leg(&mut self, stream: u64, cell: &str, control: bool) {
        let url = {
            let shared = self.shared.lock().unwrap();
            let route = shared.floor.placement.cells.get(cell);
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
    use super::super::hello::{decide, Admit, Host, PeerRole};
    use super::super::keyring::{CellRoute, SessionRoute};
    use super::super::testing::*;
    use super::*;
    use crate::tp::grant::GrantKey;
    use std::sync::atomic::{AtomicU64, Ordering};
    use tokio::net::TcpListener;

    fn floor(cell: &str, terminals: bool) -> FloorState {
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
        FloorState {
            placement,
            terminals,
            approval_key: approval_key(),
            admit: Admit::default(),
            device_id: None,
        }
    }

    /// A host on a loopback port, the vector's node admitted as `role`. Like the binary, it runs
    /// every link it accepts on one `Shared`; it hands back each link's commands, in accept order,
    /// and the lines the links report.
    struct TestHost {
        port: u16,
        shared: Arc<Mutex<Shared>>,
        links: mpsc::UnboundedReceiver<mpsc::UnboundedSender<LinkCommand>>,
        reports: mpsc::UnboundedReceiver<Value>,
    }

    async fn host_on(role: PeerRole, floor: FloorState, now: fn() -> u64) -> TestHost {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let keyrings = HashMap::new();
        let shared = Arc::new(Mutex::new(Shared { floor, keyrings }));
        let (links_out, links) = mpsc::unbounded_channel();
        let (reports_out, reports) = mpsc::unbounded_channel();
        let serving = shared.clone();
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let shared = serving.clone();
                let (links_out, reports_out) = (links_out.clone(), reports_out.clone());
                tokio::spawn(async move {
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
                        let (commands_out, commands) = mpsc::unbounded_channel();
                        let _ = links_out.send(commands_out);
                        run(ws, admitted, shared, commands, reports_out, now).await;
                    }
                });
            }
        });
        TestHost {
            port,
            shared,
            links,
            reports,
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
        let host = host_on(PeerRole::Desktop, floor(&cell, true), fixed).await;
        let mut ws = dial(host.port, desktop_hello()).await;
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
        let host = host_on(PeerRole::Desktop, floor(&cell, true), fixed).await;
        let mut ws = dial(host.port, desktop_hello()).await;
        let leg = br#"{"kind":"terminal-leg","cellBootId":"cb-1","channel":"frames"}"#;
        send(&mut ws, FrameType::Open, 1, leg).await;
        assert_eq!(next(&mut ws).await, (FrameType::Opened, 1, b"{}".to_vec()));
        drop(ws);
        let end = tokio::time::timeout(Duration::from_secs(5), ended.recv());
        assert_eq!(end.await.expect("the leg's end"), Some(Some(1001)));
    }

    #[tokio::test]
    async fn the_link_acks_what_it_received_and_refuses_what_it_cannot_serve() {
        let host = host_on(PeerRole::Desktop, floor("ws://127.0.0.1:1", true), fixed).await;
        let mut ws = dial(host.port, desktop_hello()).await;
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
        let mut ws = dial(hidden.port, desktop_hello()).await;
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
        let mut host = host_on(PeerRole::Phone, floor("ws://127.0.0.1:1", true), now).await;
        let mut ws = dial(host.port, phone_hello()).await;
        let tickets = br#"{"kind":"terminal-tickets","sessionIds":["sess-a"]}"#;
        send(&mut ws, FrameType::Open, 1, tickets).await;
        let (kind, stream, opened) = next(&mut ws).await;
        assert_eq!((kind, stream), (FrameType::Opened, 1));
        let ticket = &json_of(&opened)["tickets"][0]["ticket"];
        let client = format!("freeway:{LOGIN}#{NODE}~hb-1");
        assert_eq!(ticket["attachGrant"]["claims"]["clientId"], json!(client));
        // The session's first ticket is its join, reported for fieldd's audit.
        let rights = json!(["geometry", "input", "read"]);
        let joined = host.reports.recv().await.unwrap();
        let row = &joined["joined"];
        assert_eq!(
            (&row["clientId"], &row["sessionId"]),
            (&json!(client), &json!("sess-a"))
        );
        assert_eq!(
            (&row["rights"], &row["at"]),
            (&rights, &json!(ISSUED + 1_000))
        );
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
        // A second ticket on the same link is the same join.
        send(&mut ws, FrameType::Open, 7, tickets).await;
        let (kind, stream, _) = next(&mut ws).await;
        assert_eq!((kind, stream), (FrameType::Opened, 7));
        let (kind, stream, _) = next(&mut ws).await;
        assert_eq!((kind, stream), (FrameType::Close, 7));
        send(&mut ws, FrameType::Close, 7, br#"{"code":1000}"#).await;

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

        // The renewal joined nothing new; the link's end is the join's leave.
        drop(ws);
        let left = tokio::time::timeout(Duration::from_secs(5), host.reports.recv());
        let left = left.await.expect("the leave").unwrap();
        assert_eq!(
            (&left["left"]["sessionId"], &left["left"]["rights"]),
            (&json!("sess-a"), &rights)
        );
    }

    #[tokio::test]
    async fn a_phone_that_reconnects_within_the_boot_mints_on_from_its_own_high_water() {
        let host = host_on(PeerRole::Phone, floor("ws://127.0.0.1:1", true), fixed).await;
        let tickets = br#"{"kind":"terminal-tickets","sessionIds":["sess-a"]}"#;
        let mut generations = Vec::new();
        for _ in 0..2 {
            let mut ws = dial(host.port, phone_hello()).await;
            send(&mut ws, FrameType::Open, 1, tickets).await;
            let (_, _, opened) = next(&mut ws).await;
            let claims =
                |grant: &str| json_of(&opened)["tickets"][0]["ticket"][grant]["claims"].clone();
            let transport = claims("transportGrant")["transportGrantGeneration"].as_u64();
            let attach = claims("attachGrant")["grantGeneration"].as_u64();
            generations.push((transport, attach));
            // The link ends: the next dial is the phone coming back, under the same client id.
            drop(ws);
        }
        assert_eq!(generations, vec![(Some(1), Some(1)), (Some(2), Some(2))]);
    }

    #[tokio::test]
    async fn a_revoked_link_mints_nothing_and_a_new_one_mints_at_the_wall() {
        let host = host_on(PeerRole::Phone, floor("ws://127.0.0.1:1", true), fixed).await;
        let tickets = br#"{"kind":"terminal-tickets","sessionIds":["sess-a"]}"#;
        let mut ws = dial(host.port, phone_hello()).await;
        send(&mut ws, FrameType::Open, 1, tickets).await;
        assert_eq!(next(&mut ws).await.0, FrameType::Opened);
        assert_eq!(next(&mut ws).await.0, FrameType::Close);
        let client = format!("freeway:{LOGIN}#{NODE}~hb-1");
        let before = {
            let mut shared = host.shared.lock().unwrap();
            shared.keyrings.get_mut(&client).unwrap().revoke()
        };
        assert_eq!(before, 2);
        // Still open until its close lands, the revoked link is answered and mints nothing.
        send(&mut ws, FrameType::Open, 3, tickets).await;
        let (kind, _, opened) = next(&mut ws).await;
        assert_eq!(kind, FrameType::Opened);
        assert_eq!(
            json_of(&opened)["tickets"][0]["refusal"]["code"],
            "UNAUTHORIZED"
        );
        // The phone, approved again, opens a new link: it mints at the wall the cells were given.
        let mut again = dial(host.port, phone_hello()).await;
        send(&mut again, FrameType::Open, 1, tickets).await;
        let (_, _, opened) = next(&mut again).await;
        let claims = &json_of(&opened)["tickets"][0]["ticket"]["attachGrant"]["claims"];
        assert_eq!(claims["grantGeneration"], json!(before));
    }

    #[tokio::test]
    async fn the_hosts_word_closes_a_link_with_its_code_and_a_restart_says_so_first() {
        let mut host = host_on(PeerRole::Desktop, floor("ws://127.0.0.1:1", true), fixed).await;
        let mut ws = dial(host.port, desktop_hello()).await;
        let commands = host.links.recv().await.unwrap();
        commands
            .send(LinkCommand::Close(codes::SUPERSEDED))
            .unwrap();
        assert_eq!(
            close_of(&mut ws).await,
            (codes::SUPERSEDED, "SUPERSEDED".to_owned())
        );

        let mut ws = dial(host.port, desktop_hello()).await;
        let commands = host.links.recv().await.unwrap();
        let restarting = json!({
            "type": "Restarting", "reason": "update", "planes": ["field-native"], "ttlMs": 8_000,
        });
        commands
            .send(LinkCommand::Restart(restarting.clone()))
            .unwrap();
        let (kind, stream, payload) = next(&mut ws).await;
        assert_eq!(
            (kind, stream, json_of(&payload)),
            (FrameType::Link, 0, restarting)
        );
        assert_eq!(
            close_of(&mut ws).await,
            (codes::RESTARTING, "RESTARTING".to_owned())
        );
    }
}
