//! The remote leg of a MeshData lane (C6-3): truffle QUIC behind the
//! `LaneTransport` seam. This is the only file in the daemon that names a QUIC
//! type — `mesh_bridge.rs` stays dumb because it structurally cannot reach one.
//!
//! ONE QUIC STREAM PER LANE, and the stream is written by exactly one side.
//! QUIC already gives independent, ordered, flow-controlled streams with no
//! head-of-line blocking between them, which is precisely the multiplexing a
//! lane wants — so a lane IS a stream, rather than another multiplexing layer
//! inside one. Half-duplex per lane is not a shortcut: `MeshLanePeerOpened`
//! declares `inbound: true` as a literal, so the contract already says a lane
//! points one way. Two-way doc-sync is a PAIR of lanes, one owned by each side.
//!
//! THE OPENER MUST WRITE. truffle documents it and the C6-3c probe measured it:
//! `accept_stream()` does not fire until the opening side sends bytes. So the
//! LANE_OPEN header is not merely how the peer learns what the lane is — it is
//! what makes the lane exist at all from the peer's side. A lane opened and
//! left silent would be invisible.
//!
//! IDENTITY COMES FROM THE ADDRESS, NEVER THE HEADER (EL7). The header says
//! what the lane carries; who opened it is resolved from the connection's
//! remote address, which the tailnet authenticated with WireGuard. A peer can
//! write anything into a header, so nothing authorization-shaped is read from
//! one. ALPN scoping (`truffle-raw.{app_id}`) means a different app cannot even
//! complete the handshake.
//!
//! WHAT THIS DOES NOT DO YET: `lossy` lanes. The class is carried, announced
//! and enforced end-to-end, but datagram delivery is its own slice — a lossy
//! lane is refused honestly here rather than quietly upgraded to a reliable
//! stream, because silently making a lane MORE reliable than asked hides
//! backpressure the caller was promised it would feel.

use crate::services::mesh::{MeshHandle, MeshNode};
use crate::services::mesh_bridge::{
    encode_frame, BridgeHandle, FrameReader, Lane, LaneClass, LaneTransport,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use truffle_core::transport::quic::{QuicConnection, QuicStream};

/// = @vibefield/contracts registries PORTS.DOC_SYNC_QUIC. Mirrored, never
/// invented; `tests/lane_transport.rs` pins it against registries.ts.
pub const DOC_SYNC_QUIC_PORT: u16 = 9440;

// ---- the native↔native wire ------------------------------------------------
// Same CODEC as the local socket (one framing implementation, one set of
// hardening tests), a deliberately DISJOINT vocabulary. The local socket's
// FRAME_HELLO=1 authenticates a same-uid process with a pairing MAC; a mesh
// lane's opener says something else entirely. Numbering them apart means a
// stream fed to the wrong reader fails loudly instead of decoding as a kind it
// never was.

/// First frame on every lane stream: what this lane is. Payload is JSON.
pub const LANE_OPEN: u8 = 0x10;
/// One opaque record — a Loro update, as far as this file is concerned a bag of
/// bytes. Record boundaries are the frame's job: QUIC is a byte stream, so
/// concatenating records without framing would hand the peer an unsplittable
/// blob.
pub const LANE_DATA: u8 = 0x11;

/// Frames queued toward one lane's stream. Bounded ON PURPOSE: an unbounded
/// queue converts a stalled peer into unbounded memory, and this is the plane
/// whole documents cross. When it fills, `send` awaits — QUIC flow control
/// reaches back through the channel to fieldd, which is the backpressure
/// `LaneTransport::send` promises for a reliable lane.
const LANE_SEND_QUEUE: usize = 256;

/// The peer's declaration about its own lane. Descriptive only — see the module
/// note on identity. `class` is honoured because it changes how bytes are
/// carried, not who may send them.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaneOpenHeader {
    pub class: String,
    pub protocol: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_id: Option<String>,
    /// The originator's lane id. Carried for correlating the two sides' logs
    /// and NOTHING else — the receiver mints its own (see `adopt_inbound_lane`).
    pub origin_lane_id: u64,
}

pub fn encode_lane_open(lane: &Lane) -> anyhow::Result<Vec<u8>> {
    let header = LaneOpenHeader {
        class: lane.class.as_str().to_string(),
        protocol: lane.protocol.clone(),
        doc_id: lane.doc_id.clone(),
        origin_lane_id: lane.lane_id,
    };
    encode_frame(LANE_OPEN, lane.lane_id, &serde_json::to_vec(&header)?)
}

pub fn decode_lane_open(payload: &[u8]) -> anyhow::Result<LaneOpenHeader> {
    let header: LaneOpenHeader = serde_json::from_slice(payload)?;
    anyhow::ensure!(
        LaneClass::parse(&header.class).is_some(),
        "unknown lane class {:?}",
        header.class
    );
    Ok(header)
}

// ---- the transport ---------------------------------------------------------

/// A lane's write end. Dropping the sender is how a lane dies: the writer task
/// sees the channel close, finishes the QUIC stream (clean EOF for the peer),
/// and exits.
struct LaneSink {
    tx: mpsc::Sender<Vec<u8>>,
}

pub struct TruffleLaneTransport {
    node: Arc<MeshNode>,
    port: u16,
    /// One connection per peer, shared by every lane pointing at it. Streams are
    /// the cheap thing; connections are not.
    conns: Mutex<HashMap<String, Arc<QuicConnection>>>,
    lanes: Mutex<HashMap<u64, LaneSink>>,
}

impl TruffleLaneTransport {
    pub fn new(node: Arc<MeshNode>, port: u16) -> Self {
        Self {
            node,
            port,
            conns: Mutex::new(HashMap::new()),
            lanes: Mutex::new(HashMap::new()),
        }
    }

    /// A stream to a peer, over the cached connection when there is a live one.
    ///
    /// The only honest test of a connection is USING it: a peer that rebooted
    /// leaves an entry in this map that looks perfectly alive, so a failed
    /// `open_stream` is what evicts it rather than a liveness flag nobody
    /// updates.
    async fn open_stream_to(&self, peer: &str) -> anyhow::Result<QuicStream> {
        // The lock is held across the dial on purpose: two lanes opening to the
        // same peer at once must not race into two connections. A tokio Mutex,
        // so awaiting under it is sound.
        let mut conns = self.conns.lock().await;
        if let Some(conn) = conns.get(peer).cloned() {
            match conn.open_stream().await {
                Ok(stream) => return Ok(stream),
                Err(e) => {
                    tracing::info!(
                        event = "field_native.lane_transport.redialling",
                        component = "lane_transport",
                        peer,
                        error = %e,
                        "The cached lane connection was dead; redialling"
                    );
                    conns.remove(peer);
                }
            }
        }
        let conn = Arc::new(
            self.node
                .connect_quic(peer, self.port)
                .await
                .map_err(|e| anyhow::anyhow!("connect_quic {peer}: {e}"))?,
        );
        let stream = conn
            .open_stream()
            .await
            .map_err(|e| anyhow::anyhow!("open_stream to {peer}: {e}"))?;
        conns.insert(peer.to_string(), conn);
        Ok(stream)
    }
}

#[async_trait::async_trait]
impl LaneTransport for TruffleLaneTransport {
    async fn open(&self, lane: &Lane) -> anyhow::Result<()> {
        anyhow::ensure!(
            lane.class == LaneClass::Reliable,
            "lossy lanes need datagram delivery, which is its own slice — refusing \
             rather than silently promoting lane {} to a reliable stream",
            lane.lane_id
        );
        let mut stream = self.open_stream_to(&lane.peer).await?;

        // The header goes out HERE, inside open(), and the call does not return
        // until it is written: this is what makes the peer's accept_stream fire.
        // Deferring it to the first payload would leave a lane that both sides
        // believe is open but only one can see.
        stream
            .write(&encode_lane_open(lane)?)
            .await
            .map_err(|e| anyhow::anyhow!("lane {} header: {e}", lane.lane_id))?;

        let (tx, mut rx) = mpsc::channel::<Vec<u8>>(LANE_SEND_QUEUE);
        let lane_id = lane.lane_id;
        tokio::spawn(async move {
            while let Some(frame) = rx.recv().await {
                if let Err(e) = stream.write(&frame).await {
                    tracing::warn!(
                        event = "field_native.lane_transport.write_failed",
                        component = "lane_transport",
                        lane_id,
                        error = %e,
                        "A lane stream write failed; the lane is finished"
                    );
                    break;
                }
            }
            // Clean EOF, so the peer reads a closed lane rather than an idle one.
            stream.finish();
        });
        self.lanes.lock().await.insert(lane_id, LaneSink { tx });
        Ok(())
    }

    async fn send(&self, lane: &Lane, payload: &[u8]) -> anyhow::Result<()> {
        let tx = {
            let lanes = self.lanes.lock().await;
            lanes
                .get(&lane.lane_id)
                .map(|s| s.tx.clone())
                .ok_or_else(|| anyhow::anyhow!("lane {} has no stream", lane.lane_id))?
        };
        // The ceiling check lives in encode_frame — one place, both legs.
        let frame = encode_frame(LANE_DATA, lane.lane_id, payload)?;
        // Awaits when the queue is full — that IS the backpressure contract.
        tx.send(frame)
            .await
            .map_err(|_| anyhow::anyhow!("lane {} stream is gone", lane.lane_id))
    }

    async fn close(&self, lane: &Lane) -> anyhow::Result<()> {
        // Dropping the sender ends the writer task, which finishes the stream.
        self.lanes.lock().await.remove(&lane.lane_id);
        Ok(())
    }
}

// ---- the inbound side ------------------------------------------------------

/// Accept lane streams forever, adopting each one into the bridge.
///
/// Every level spawns rather than serialising: one wedged peer must not stop
/// the listener, and one wedged lane must not stop its connection. That is D5's
/// "a torn frame tears the LANE, never the daemon" applied to the remote leg.
pub async fn serve_inbound(node: Arc<MeshNode>, bridge: BridgeHandle, port: u16) {
    let listener = match node.listen_quic(port).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!(
                event = "field_native.lane_transport.listen_failed",
                component = "lane_transport",
                port,
                error = %e,
                "Inbound mesh lanes are unavailable: the QUIC listener did not bind"
            );
            return;
        }
    };
    tracing::info!(
        event = "field_native.lane_transport.listening",
        component = "lane_transport",
        port,
        "Inbound mesh lanes are open"
    );
    while let Some(conn) = listener.accept().await {
        let node = node.clone();
        let bridge = bridge.clone();
        tokio::spawn(async move { serve_connection(node, bridge, conn).await });
    }
}

async fn serve_connection(node: Arc<MeshNode>, bridge: BridgeHandle, conn: QuicConnection) {
    // EL7: the peer's identity is the tailnet's answer about the address that
    // dialled us, not the stream's answer about itself. An unresolvable address
    // is reported as such — a peer field that reads "unknown" is honest, and
    // fieldd can refuse it; a fabricated one would not be.
    let addr = conn.remote_address();
    let peer = resolve_peer_by_ip(&node, addr.ip().to_string()).await;
    tracing::info!(
        event = "field_native.lane_transport.peer_connected",
        component = "lane_transport",
        peer = %peer,
        "A peer opened a mesh lane connection"
    );
    loop {
        match conn.accept_stream().await {
            Ok(Some(stream)) => {
                let bridge = bridge.clone();
                let peer = peer.clone();
                tokio::spawn(async move { serve_lane_stream(bridge, peer, stream).await });
            }
            Ok(None) => break, // connection closed by either side
            Err(e) => {
                tracing::warn!(
                    event = "field_native.lane_transport.accept_stream_failed",
                    component = "lane_transport",
                    peer = %peer,
                    error = %e,
                    "A peer's lane connection ended"
                );
                break;
            }
        }
    }
}

/// One inbound lane, from its header to its EOF.
async fn serve_lane_stream(bridge: BridgeHandle, peer: String, mut stream: QuicStream) {
    let mut reader = FrameReader::default();
    let mut lane_id: Option<u64> = None;

    loop {
        let chunk = match stream.read(64 * 1024).await {
            Ok(Some(c)) => c,
            Ok(None) => break, // clean EOF: the peer closed the lane
            Err(e) => {
                tracing::warn!(
                    event = "field_native.lane_transport.read_failed",
                    component = "lane_transport",
                    peer = %peer,
                    error = %e,
                    "A lane stream read failed"
                );
                if let Some(id) = lane_id {
                    bridge.forget_lane(id, "torn-frame");
                }
                return;
            }
        };
        let frames = match reader.push(&chunk) {
            Ok(f) => f,
            Err(e) => {
                // Structural garbage on ONE lane. Its stream is unrecoverable
                // (there is no marker to resynchronise on), but the connection
                // and every sibling lane on it are untouched.
                tracing::warn!(
                    event = "field_native.lane_transport.frame_error",
                    component = "lane_transport",
                    peer = %peer,
                    error = %e,
                    "A lane's framing tore; dropping that lane only"
                );
                if let Some(id) = lane_id {
                    bridge.forget_lane(id, "torn-frame");
                }
                return;
            }
        };
        for frame in frames {
            match (frame.kind, lane_id) {
                (LANE_OPEN, None) => match decode_lane_open(&frame.payload) {
                    Ok(header) => {
                        let class = LaneClass::parse(&header.class).unwrap_or(LaneClass::Reliable);
                        let lane = bridge.adopt_inbound_lane(
                            class,
                            peer.clone(),
                            header.protocol.clone(),
                            header.doc_id.clone(),
                        );
                        tracing::info!(
                            event = "field_native.lane_transport.lane_adopted",
                            component = "lane_transport",
                            lane_id = lane.lane_id,
                            origin_lane_id = header.origin_lane_id,
                            peer = %peer,
                            protocol = %header.protocol,
                            "A peer's lane was adopted"
                        );
                        lane_id = Some(lane.lane_id);
                    }
                    Err(e) => {
                        tracing::warn!(
                            event = "field_native.lane_transport.bad_header",
                            component = "lane_transport",
                            peer = %peer,
                            error = %e,
                            "A lane's opening header was unreadable; refusing the lane"
                        );
                        return;
                    }
                },
                (LANE_DATA, Some(id)) => bridge.deliver_inbound(id, &frame.payload),
                (LANE_DATA, None) => {
                    // Data before the header: the peer skipped the one frame
                    // that says what this lane is. There is no lane to route to
                    // and no way to invent one.
                    tracing::warn!(
                        event = "field_native.lane_transport.data_before_header",
                        component = "lane_transport",
                        peer = %peer,
                        "A lane sent data before declaring itself; refusing the lane"
                    );
                    return;
                }
                // Tolerant reader: a newer peer may frame a kind this daemon has
                // no opinion about, and that is not a reason to kill its lane.
                _ => {}
            }
        }
    }

    if let Some(id) = lane_id {
        bridge.forget_lane(id, "peer-closed");
    }
}

/// Tailnet IP → peer id, using the same `PeerInfo.id` (`tailscale_id`) that
/// `native.mesh.peers.list` publishes — so the peer named in a `lane.peerOpened`
/// is the same string fieldd would pass back to `lane.open`.
async fn resolve_peer_by_ip(node: &Arc<MeshNode>, ip: String) -> String {
    node.peers()
        .await
        .into_iter()
        .find(|p| p.ip.to_string() == ip)
        .map(|p| p.tailscale_id)
        .unwrap_or_else(|| format!("unknown:{ip}"))
}

// ---- installation ----------------------------------------------------------

/// Park until the mesh node exists, then put the remote leg behind the bridge's
/// seam and start accepting inbound lanes.
///
/// Spawned once at boot. With the mesh disabled — the default — it simply never
/// fires, and lanes stay local-only, which `lane.open` already reports honestly
/// as UNAVAILABLE with the mesh unit's real state.
pub fn install_when_ready(
    mesh: MeshHandle,
    bridge: BridgeHandle,
    port: u16,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let node = mesh.wait_for_node().await;
        bridge.set_transport(Arc::new(TruffleLaneTransport::new(node.clone(), port)));
        tracing::info!(
            event = "field_native.lane_transport.installed",
            component = "lane_transport",
            port,
            "The mesh lane transport is live"
        );
        serve_inbound(node, bridge, port).await;
    })
}

#[cfg(test)]
mod tests {
    //! The wire's pure half. Everything that needs two tailnet nodes lives in
    //! `tests/quic_lane_transport.rs`, gated and ignored.
    use super::*;

    fn lane() -> Lane {
        Lane {
            lane_id: 7,
            class: LaneClass::Reliable,
            peer: "ts-peer".into(),
            protocol: "doc-sync".into(),
            doc_id: Some("doc-1".into()),
            inbound: false,
        }
    }

    #[test]
    fn a_lane_open_frame_round_trips() {
        let framed = encode_lane_open(&lane()).expect("encode");
        let mut reader = FrameReader::default();
        let frames = reader.push(&framed).expect("decode");
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].kind, LANE_OPEN);
        assert_eq!(frames[0].lane_id, 7);
        let header = decode_lane_open(&frames[0].payload).expect("header");
        assert_eq!(header.class, "reliable");
        assert_eq!(header.protocol, "doc-sync");
        assert_eq!(header.doc_id.as_deref(), Some("doc-1"));
        assert_eq!(header.origin_lane_id, 7);
    }

    #[test]
    fn the_mesh_leg_and_the_local_leg_do_not_share_a_vocabulary() {
        // Same codec, disjoint kinds — a stream fed to the wrong reader must
        // fail loudly rather than decode as a kind it never was.
        use crate::services::mesh_bridge::{FRAME_DATA, FRAME_ERR, FRAME_HELLO, FRAME_HELLO_OK};
        for local in [FRAME_HELLO, FRAME_HELLO_OK, FRAME_DATA, FRAME_ERR] {
            assert_ne!(local, LANE_OPEN);
            assert_ne!(local, LANE_DATA);
        }
    }

    #[test]
    fn a_header_with_an_unknown_class_is_refused_not_defaulted() {
        let payload = serde_json::to_vec(&serde_json::json!({
            "class": "telepathic", "protocol": "doc-sync", "origin_lane_id": 1
        }))
        .unwrap();
        let err = decode_lane_open(&payload).expect_err("unknown class must be refused");
        assert!(err.to_string().contains("telepathic"), "{err}");
    }

    #[test]
    fn a_header_missing_its_protocol_is_refused() {
        let payload =
            serde_json::to_vec(&serde_json::json!({"class": "reliable", "origin_lane_id": 1}))
                .unwrap();
        assert!(decode_lane_open(&payload).is_err());
    }

    #[test]
    fn a_doc_less_lane_omits_doc_id_rather_than_sending_null() {
        let mut l = lane();
        l.doc_id = None;
        let framed = encode_lane_open(&l).unwrap();
        let text = String::from_utf8_lossy(&framed);
        assert!(
            !text.contains("doc_id"),
            "presence lanes carry no doc: {text}"
        );
        let mut reader = FrameReader::default();
        let frames = reader.push(&framed).unwrap();
        assert!(decode_lane_open(&frames[0].payload)
            .unwrap()
            .doc_id
            .is_none());
    }

    #[test]
    fn the_port_matches_the_contracts_registry() {
        let src = std::fs::read_to_string(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../contracts/src/registries.ts"),
        )
        .expect("read registries.ts");
        assert!(
            src.contains(&format!("DOC_SYNC_QUIC: {DOC_SYNC_QUIC_PORT},")),
            "registries.ts does not declare DOC_SYNC_QUIC: {DOC_SYNC_QUIC_PORT}"
        );
    }
}
