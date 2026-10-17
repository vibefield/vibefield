//! Test-side TPv3 door dialing: one control hello to a cell's door, and the answer's `type` and
//! `code`. Included by `#[path]` from the test crates that need it; the hello's text comes from
//! the caller (`tp_mint::hello`), so this module mints nothing.
#![allow(dead_code)]

use futures_util::{SinkExt, StreamExt};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub async fn control_hello(url: &str, hello: String) -> (String, String) {
    let (mut ws, _) = tokio::time::timeout(
        Duration::from_secs(5),
        tokio_tungstenite::connect_async(url.to_owned()),
    )
    .await
    .expect("dial within 5s")
    .expect("the cell's door accepts the upgrade");
    ws.send(Message::Text(hello.into()))
        .await
        .expect("send hello");
    let reply = tokio::time::timeout(Duration::from_secs(5), ws.next())
        .await
        .expect("a reply within 5s")
        .expect("a reply")
        .expect("a frame");
    let Message::Text(text) = reply else {
        panic!("expected a text reply, got {reply:?}");
    };
    let reply: serde_json::Value = serde_json::from_str(text.as_str()).expect("json");
    let field = |name: &str| reply[name].as_str().unwrap_or_default().to_owned();
    (field("type"), field("code"))
}
