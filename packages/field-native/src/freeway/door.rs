//! FW (v0.3 §3) — the link's door: one WebSocket on the floor-held loopback listener. Only an
//! upgrade on the secret path `/f/<pathSecret>` (compared in constant time) is heard, and only
//! with the identity the sidecar injected there (`Tailscale-User-Login`, `Tailscale-Node-Id`);
//! anything else is refused at the HTTP upgrade (404 for the path, 403 for a missing identity),
//! so a same-uid process that dials the port and types headers is nobody (C3's pattern,
//! `product-api.ts` `classifyDoor`). Then the first message, within the hello deadline, is
//! decided (`hello::decide`): the welcome on stream 0, or `FreewayRefused` and the close.

use super::frame::{decode, encode, Frame, FrameType};
use super::hello::{Admitted, Identity, Refused};
use crate::registries::{freeway as limits, freeway_codes as codes};
use futures_util::{SinkExt, StreamExt};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, WebSocketConfig};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

pub type Ws = WebSocketStream<TcpStream>;

pub struct DoorConfig {
    /// The floor-minted `pathSecret`: the serve's one route ends at `/f/<pathSecret>`.
    pub path_secret: String,
    /// How long a dialer has to send its hello.
    pub hello_deadline: Duration,
}

impl DoorConfig {
    pub fn new(path_secret: String) -> Self {
        let deadline = limits::HEARTBEAT_MS * limits::MISSED_PINGS;
        Self {
            path_secret,
            hello_deadline: Duration::from_millis(deadline),
        }
    }
}

/// The largest frame this door reads: one stream window. A TEXT or BINARY frame carries at most
/// a fragment; an OPENED's answer (a tickets row set) is the largest unfragmented frame.
const MAX_FRAME_BYTES: usize = limits::STREAM_WINDOW_BYTES as usize;

fn ws_config() -> WebSocketConfig {
    WebSocketConfig::default()
        .max_message_size(Some(MAX_FRAME_BYTES))
        .max_frame_size(Some(MAX_FRAME_BYTES))
        .accept_unmasked_frames(false)
}

/// Accept one connection: the secret path, the injected identity, the hello. A link admitted
/// comes back with its socket, its welcome already sent; anything else has been answered and
/// closed.
// The upgrade callback's error type is tungstenite's `ErrorResponse` (an http Response) — large
// by their definition, not ours to shrink.
#[allow(clippy::result_large_err)]
pub async fn accept(
    stream: TcpStream,
    config: &DoorConfig,
    decide: impl FnOnce(&[u8], &Identity) -> Result<Admitted, Refused>,
) -> Option<(Ws, Admitted)> {
    let heard = Arc::new(Mutex::new(None::<Identity>));
    let capture = heard.clone();
    let secret = config.path_secret.clone();
    let callback = move |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
        let candidate = req.uri().path().strip_prefix("/f/").unwrap_or("");
        if secret.is_empty() || !same(candidate.as_bytes(), secret.as_bytes()) {
            return Err(status(404));
        }
        let header = |name: &str| {
            req.headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
        };
        match (header("tailscale-user-login"), header("tailscale-node-id")) {
            (Some(login), Some(node_id)) => {
                *capture.lock().unwrap() = Some(Identity { login, node_id });
                Ok(resp)
            }
            // A tagged node, a WhoIs miss or an older sidecar: no identity to admit.
            _ => Err(status(403)),
        }
    };
    let mut ws =
        tokio_tungstenite::accept_hdr_async_with_config(stream, callback, Some(ws_config()))
            .await
            .ok()?;
    let identity = heard.lock().unwrap().take()?;
    let first = tokio::time::timeout(config.hello_deadline, ws.next()).await;
    let bytes = match first {
        Ok(Some(Ok(Message::Binary(bytes)))) => bytes,
        _ => {
            close(&mut ws, codes::PROTOCOL, "PROTOCOL").await;
            return None;
        }
    };
    let hello = match decode(&bytes) {
        Ok(frame) if frame.kind == FrameType::Link => frame.payload,
        _ => {
            close(&mut ws, codes::PROTOCOL, "PROTOCOL").await;
            return None;
        }
    };
    match decide(hello, &identity) {
        Ok(admitted) => {
            let welcome = serde_json::to_vec(&admitted.welcome).ok()?;
            ws.send(Message::Binary(link_frame(&welcome)?.into()))
                .await
                .ok()?;
            Some((ws, admitted))
        }
        Err(refused) => {
            if let Ok(payload) = serde_json::to_vec(&refused.payload()) {
                if let Some(frame) = link_frame(&payload) {
                    let _ = ws.send(Message::Binary(frame.into())).await;
                }
            }
            close(&mut ws, refused.close, refused.code).await;
            None
        }
    }
}

fn link_frame(payload: &[u8]) -> Option<Vec<u8>> {
    encode(&Frame {
        kind: FrameType::Link,
        fragment: false,
        stream: 0,
        payload,
    })
    .ok()
}

/// Constant time over equal lengths: a prober learns nothing from how long a guess took.
fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn status(code: u16) -> ErrorResponse {
    let mut response = ErrorResponse::new(None);
    *response.status_mut() = http::StatusCode::from_u16(code).expect("a valid status");
    response
}

/// Send our close and let the handshake finish (bounded), so the dialer reads OUR code.
async fn close(ws: &mut Ws, code: u16, reason: &str) {
    let frame = CloseFrame {
        code: CloseCode::from(code),
        reason: reason.to_owned().into(),
    };
    let _ = ws.close(Some(frame)).await;
    let drain = async { while let Some(Ok(_)) = ws.next().await {} };
    let _ = tokio::time::timeout(Duration::from_secs(2), drain).await;
}

#[cfg(test)]
mod tests {
    use super::super::approval::ApprovalKey;
    use super::super::hello::{decide as decide_hello, Admit, Host, PeerRole};
    use super::*;
    use serde_json::Value;
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    const HOST: Host<'static> = Host {
        link_id: "lk-1",
        host_boot_id: "hb-1",
        floor_boot_id: "fb-1",
        device_id: "dev-desktop-a",
    };

    fn key() -> ApprovalKey {
        ApprovalKey {
            floor_boot_id: "fb-1".into(),
            key_generation: 1,
            key: vec![1; 32],
        }
    }

    async fn serve_one(listener: &TcpListener) -> Option<Admitted> {
        let (stream, _) = listener.accept().await.unwrap();
        let mut admit = Admit::default();
        admit.insert("nDESK", "dev-desktop-b", PeerRole::Desktop);
        admit.insert("nPHONE", "dev-phone-1", PeerRole::Phone);
        let config = DoorConfig::new("s3cret".into());
        accept(stream, &config, |payload, identity| {
            decide_hello(payload, identity, &admit, &key(), &HOST, 0)
        })
        .await
        .map(|(_, admitted)| admitted)
    }

    async fn dial(
        port: u16,
        path: &str,
        headers: &[(&'static str, &str)],
    ) -> Result<WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>, u16> {
        let mut request = format!("ws://127.0.0.1:{port}{path}")
            .into_client_request()
            .unwrap();
        for (name, value) in headers {
            request.headers_mut().insert(*name, value.parse().unwrap());
        }
        match tokio_tungstenite::connect_async(request).await {
            Ok((ws, _)) => Ok(ws),
            Err(tokio_tungstenite::tungstenite::Error::Http(response)) => {
                Err(response.status().as_u16())
            }
            Err(other) => panic!("dial: {other}"),
        }
    }

    const PEER_HELLO: &[u8] =
        br#"{"type":"FreewayPeerHello","protocol":{"major":1,"minor":0},"capabilities":[]}"#;

    #[tokio::test]
    async fn the_door_hears_only_the_secret_path_and_only_with_an_identity() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let mut admitted = Vec::new();
            for _ in 0..2 {
                admitted.push(serve_one(&listener).await.is_some());
            }
            admitted
        });
        let identity = [
            ("tailscale-user-login", "person@example.com"),
            ("tailscale-node-id", "nDESK"),
        ];
        assert_eq!(dial(port, "/f/guess", &identity).await.err(), Some(404));
        let login_only = [("tailscale-user-login", "person@example.com")];
        assert_eq!(dial(port, "/f/s3cret", &login_only).await.err(), Some(403));
        assert_eq!(server.await.unwrap(), vec![false, false]);
    }

    #[tokio::test]
    async fn an_admitted_desktop_is_welcomed_and_a_phone_node_on_the_peer_hello_is_refused() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let first = serve_one(&listener).await.map(|a| a.device_id);
            let second = serve_one(&listener).await.map(|a| a.device_id);
            (first, second)
        });
        let hello = link_frame(PEER_HELLO).unwrap();

        let desk = [
            ("tailscale-user-login", "person@example.com"),
            ("tailscale-node-id", "nDESK"),
        ];
        let mut ws = dial(port, "/f/s3cret", &desk).await.unwrap();
        ws.send(Message::Binary(hello.clone().into()))
            .await
            .unwrap();
        let Some(Ok(Message::Binary(reply))) = ws.next().await else {
            panic!("a welcome")
        };
        let frame = decode(&reply).unwrap();
        let welcome: Value = serde_json::from_slice(frame.payload).unwrap();
        assert_eq!((frame.kind, frame.stream), (FrameType::Link, 0));
        assert_eq!(welcome["type"], "FreewayWelcome");
        assert_eq!(welcome["deviceId"], "dev-desktop-a");

        let phone = [
            ("tailscale-user-login", "person@example.com"),
            ("tailscale-node-id", "nPHONE"),
        ];
        let mut ws = dial(port, "/f/s3cret", &phone).await.unwrap();
        ws.send(Message::Binary(hello.into())).await.unwrap();
        let Some(Ok(Message::Binary(reply))) = ws.next().await else {
            panic!("a refusal")
        };
        let refused: Value = serde_json::from_slice(decode(&reply).unwrap().payload).unwrap();
        assert_eq!(refused["type"], "FreewayRefused");
        assert_eq!(refused["code"], "IDENTITY_MISMATCH");
        let Some(Ok(Message::Close(Some(close)))) = ws.next().await else {
            panic!("a close")
        };
        assert_eq!(u16::from(close.code), codes::NOT_ADMITTED);
        // Polling once more flushes our close reply, so the door's drain ends at once.
        let _ = ws.next().await;

        assert_eq!(
            server.await.unwrap(),
            (Some("dev-desktop-b".to_owned()), None)
        );
    }
}
