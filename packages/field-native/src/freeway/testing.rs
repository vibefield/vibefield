//! The freeway's test rig, shared by the link's rows and the host's: the approval vector's
//! identity and signer, a client that dials a door as that node, frames out and in, and a cell's
//! door faked. Test-only.

use super::approval::ApprovalKey;
use super::frame::{decode, encode, Frame, FrameType};
use crate::registries::freeway as limits;
use crate::tp::jcs::canonical_json;
use data_encoding::BASE64URL_NOPAD;
use futures_util::{SinkExt, StreamExt};
use hmac::{Hmac, KeyInit, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message as WsMessage;

pub(crate) type Client =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// The approval vector's floor, node and login (`freeway-approval-mac.vector.json`).
pub(crate) const FLOOR_BOOT: &str = "fb-0191b04e-2026";
pub(crate) const NODE: &str = "nKMWkU9CYk11CNTRL";
pub(crate) const LOGIN: &str = "person@example.com";
pub(crate) const ISSUED: u64 = 1_787_788_800_000;

pub(crate) fn fixed() -> u64 {
    ISSUED + 1_000
}

pub(crate) fn json_of(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).unwrap()
}

pub(crate) fn approval_key() -> ApprovalKey {
    ApprovalKey {
        floor_boot_id: FLOOR_BOOT.into(),
        key_generation: 1,
        key: vec![0xa5; 32],
    }
}

pub(crate) fn approval(issued: u64) -> Value {
    approval_for(NODE, issued)
}

/// The vector's approval for `node`, issued at `issued`, signed with the floor's key as
/// fieldd signs.
pub(crate) fn approval_for(node: &str, issued: u64) -> Value {
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

/// A cell's door, faked: it echoes every message, closes with 4003 when told "bye", and
/// answers a close with its own code (tungstenite's reply, which its next read flushes). Each
/// connection's end is reported, with the close code it was sent, if any.
pub(crate) async fn fake_cell() -> (String, mpsc::UnboundedReceiver<Option<u16>>) {
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

/// The link's close, past any frames before it: (code, reason).
pub(crate) async fn close_of(ws: &mut Client) -> (u16, String) {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(5), ws.next());
        let message = message.await.expect("a close").expect("a message").unwrap();
        if let WsMessage::Close(Some(frame)) = message {
            return (u16::from(frame.code), frame.reason.to_string());
        }
    }
}

/// Dial the host as the vector's node, say `hello`, and read the answer: its welcome, or its
/// refusal.
pub(crate) async fn open(port: u16, hello: Value) -> (Client, Value) {
    let url = format!("ws://127.0.0.1:{port}/f/s3cret");
    let mut request = url.into_client_request().unwrap();
    let headers = request.headers_mut();
    headers.insert("tailscale-user-login", LOGIN.parse().unwrap());
    headers.insert("tailscale-node-id", NODE.parse().unwrap());
    let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    send(&mut ws, FrameType::Link, 0, hello.to_string().as_bytes()).await;
    let (kind, stream, answer) = next(&mut ws).await;
    assert_eq!((kind, stream), (FrameType::Link, 0));
    (ws, json_of(&answer))
}

/// Dial as the vector's node, welcomed.
pub(crate) async fn dial(port: u16, hello: Value) -> Client {
    let (ws, welcome) = open(port, hello).await;
    assert_eq!(welcome["type"], "FreewayWelcome");
    ws
}

pub(crate) fn desktop_hello() -> Value {
    json!({ "type": "FreewayPeerHello", "protocol": { "major": 1, "minor": 0 } })
}

pub(crate) fn phone_hello() -> Value {
    let protocol = json!({ "major": 1, "minor": 0 });
    json!({ "type": "FreewayHello", "protocol": protocol, "approval": approval(ISSUED) })
}

pub(crate) async fn send(ws: &mut Client, kind: FrameType, stream: u64, payload: &[u8]) {
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
pub(crate) async fn next(ws: &mut Client) -> (FrameType, u64, Vec<u8>) {
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
