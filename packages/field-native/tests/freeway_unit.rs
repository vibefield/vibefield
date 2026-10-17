//! F1 — the floor's freeway unit on a booted floor, driven through its handle as the mgmt arms
//! drive it, with the REAL `field-freeway-host` (cargo builds it for this test). What these rows
//! pin is the unit's lifecycle: nothing runs before fieldd's first declaration; then the host
//! serves the floor-held listener with the floor boot's secrets; a desktop link through it is
//! welcomed with THIS desktop's id and shows in the state's links; a declaration that drops the
//! node takes its link (4410); a revoke with no phone link closes none; the floor's shutdown takes
//! the host with it. The protocol has its own rows in `freeway::host` and `tests/freeway_host.rs`.

use field_native::contracts::UnitState;
use field_native::freeway::frame::{decode, encode, Frame, FrameType};
use field_native::{bootstrap, config::NativeConfig};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::sync::watch;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

const NODE: &str = "nFREEWAYTEST01";
const LOGIN: &str = "person@example.com";

/// Short enough for the cells' socket paths (sun_path), as `terminal_unit`'s.
fn short_tempdir() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("vffw")
        .tempdir_in("/tmp")
        .expect("tempdir under /tmp")
}

fn declaration(admit: Value) -> Value {
    let exposure = json!({ "terminals": true });
    json!({ "deviceId": "dev-desktop-a", "admit": admit, "doors": {}, "exposure": exposure })
}

async fn state_where(
    rx: &mut watch::Receiver<Value>,
    what: &str,
    test: impl Fn(&Value) -> bool,
) -> Value {
    let reached = timeout(Duration::from_secs(20), rx.wait_for(|state| test(state))).await;
    let state = reached.unwrap_or_else(|_| panic!("the state never {what}"));
    state.expect("the state lives").clone()
}

/// Dial the host as `NODE` through the floor-held listener, say a desktop's hello, and read the
/// answer.
async fn dial(port: u64, secret: &str) -> (Ws, Value) {
    let mut request = format!("ws://127.0.0.1:{port}/f/{secret}")
        .into_client_request()
        .unwrap();
    let headers = request.headers_mut();
    headers.insert("tailscale-user-login", LOGIN.parse().unwrap());
    headers.insert("tailscale-node-id", NODE.parse().unwrap());
    let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    let hello = json!({ "type": "FreewayPeerHello", "protocol": { "major": 1, "minor": 0 } });
    let hello = hello.to_string();
    let frame = Frame {
        kind: FrameType::Link,
        fragment: false,
        stream: 0,
        payload: hello.as_bytes(),
    };
    ws.send(Message::Binary(encode(&frame).unwrap().into()))
        .await
        .unwrap();
    loop {
        let message = timeout(Duration::from_secs(5), ws.next())
            .await
            .expect("an answer");
        if let Message::Binary(bytes) = message.unwrap().unwrap() {
            let frame = decode(&bytes).unwrap();
            let answer = serde_json::from_slice(frame.payload).unwrap();
            return (ws, answer);
        }
    }
}

async fn close_code(ws: &mut Ws) -> u16 {
    loop {
        let message = timeout(Duration::from_secs(5), ws.next())
            .await
            .expect("a close");
        if let Message::Close(Some(frame)) = message.unwrap().unwrap() {
            return u16::from(frame.code);
        }
    }
}

#[tokio::test]
async fn the_host_starts_on_the_first_declaration_and_serves_the_floor_held_listener() {
    let dir = short_tempdir();
    let daemon = bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))
        .await
        .expect("bootstrap");
    let freeway = daemon.state.freeway.clone();
    let mut state = freeway.state_rx();

    // Nothing runs before fieldd's word, and the floor is not degraded by a host it has not asked
    // for.
    assert_eq!(state.borrow()["up"], json!(false));
    let units = daemon.state.health_tx.borrow().units.clone();
    let row = units
        .iter()
        .find(|unit| unit.unit == "freeway")
        .expect("the freeway unit's row");
    assert_eq!(row.state, UnitState::Up, "{:?}", row.detail);

    // The test is the mesh here: the peer row a node would give.
    freeway.set_peers(vec![json!({ "deviceId": "dev-b", "nodeId": NODE })]);
    freeway.declare(declaration(
        json!([{ "deviceId": "dev-b", "role": "desktop" }]),
    ));
    let up = state_where(&mut state, "came up", |state| state["up"] == json!(true)).await;
    let port = up["port"].as_u64().expect("the listener's port");
    let secret = up["pathSecret"]
        .as_str()
        .expect("the path secret")
        .to_owned();
    assert!(up["freewayKeyHex"]
        .as_str()
        .is_some_and(|key| key.len() == 64));

    let (mut ws, welcome) = dial(port, &secret).await;
    assert_eq!(welcome["type"], "FreewayWelcome", "{welcome}");
    assert_eq!(welcome["deviceId"], "dev-desktop-a");
    assert_eq!(welcome["hostBootId"], up["hostBootId"]);
    assert_eq!(welcome["floorBootId"], json!(daemon.boot_id));
    let link = json!([{ "deviceId": "dev-b", "state": "up" }]);
    state_where(&mut state, "showed the link", |state| {
        state["links"] == link
    })
    .await;

    // A revoke with no phone link closes none.
    assert_eq!(freeway.revoke(None).await, Ok(0));

    // fieldd's next word drops the node: its link goes, 4410, and the state says so.
    freeway.declare(declaration(json!([])));
    assert_eq!(close_code(&mut ws).await, 4410);
    state_where(&mut state, "dropped the link", |state| {
        state["links"] == json!([])
    })
    .await;

    // The floor's shutdown takes the host with it.
    daemon.shutdown().await;
    assert_eq!(state.borrow()["up"], json!(false));
}
