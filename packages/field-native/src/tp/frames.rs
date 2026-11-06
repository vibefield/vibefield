//! Frame routing, once per cell (RV #93, native-tp-4). G22's service publishes
//! every session's TRF1 packets on its ONE hub (`ServiceSessions::frames`; one
//! per cell since ghosttea 0.12, by design). Handed to every pump, that hub
//! made each pump its own router: woken for every frame of every session in
//! the cell, parked pumps included, and filtering by handle only after the
//! wake (N pumps × f frames of wakes, each one a registry read). A lag on it
//! was a neighbour's as often as the session's own (RV #116).
//!
//! `FrameRouter` subscribes to the hub ONCE and routes each packet by its
//! `session_handle` into that session's own bounded channel. A pump holds a
//! `FrameFeed` (its session's route, never the cell's session set) and
//! subscribes only while live, so:
//! - a pump wakes only for its own session's frames, and a parked one for none;
//! - a `FrameLoss::Lost` is this session's loss: its own route lagged, or the
//!   router itself fell behind the hub. The router never blocks, so that takes
//!   a starved router task, and whose frames it lost is not knowable here (the
//!   hub's history that would say is `pub(crate)` in ghosttea): every route is
//!   told, the same conservative fallback as ghosttea's incomplete history;
//! - a session nobody watches costs one map lookup per packet: a route whose
//!   last receiver is gone is pruned on its next packet, and every subscribe
//!   prunes the routes nobody holds, so a session that ended unwatched leaves
//!   no route behind.
//!
//! Routing and subscribing take the same lock, so a subscriber sees every
//! packet routed after its subscribe.

use ghosttea::{FrameHub, FramePacket};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;

/// The bound on one session's routed, unread frames. A memory bound, not a
/// wire number (like `UNACKED_UNITS_CAP`): past it the session's own receiver
/// lags, and that is the session's own loss.
pub const ROUTE_CAPACITY: usize = 32;

#[derive(Clone, Debug)]
enum Routed {
    Frame(FramePacket),
    /// The router fell behind the hub: some frames, nobody knows whose.
    Gap,
}

/// Why a session's frames did not come.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameLoss {
    /// Some of THIS session's frames never arrived: the lineage needs a whole
    /// frame.
    Lost,
    /// The hub (or the router over it) is gone: no frame will come.
    Closed,
}

#[derive(Default)]
struct Routes {
    table: Mutex<Table>,
}

#[derive(Default)]
struct Table {
    by_handle: HashMap<u64, broadcast::Sender<Routed>>,
    closed: bool,
}

impl Routes {
    /// One packet to its session's route. A route nobody holds is pruned.
    fn route(&self, packet: FramePacket) {
        let handle = packet.session_handle;
        let mut table = self.table.lock().unwrap();
        let unheard = match table.by_handle.get(&handle) {
            Some(route) => route.send(Routed::Frame(packet)).is_err(),
            None => false,
        };
        if unheard {
            table.by_handle.remove(&handle);
        }
    }

    /// The router lost packets it cannot attribute: every route is told.
    fn gap(&self) {
        let mut table = self.table.lock().unwrap();
        let routes = &mut table.by_handle;
        routes.retain(|_, route| route.send(Routed::Gap).is_ok());
    }

    /// Dropping every sender closes each route once its receivers drain it.
    fn close(&self) {
        let mut table = self.table.lock().unwrap();
        table.closed = true;
        table.by_handle.clear();
    }

    /// Gets or creates `handle`'s route and subscribes to it. Every route
    /// nobody holds is pruned first: a session that ended unwatched publishes
    /// no packet that would prune its own, so it would stay for the cell's life.
    fn subscribe(&self, handle: u64) -> SessionFrames {
        let mut table = self.table.lock().unwrap();
        if table.closed {
            return SessionFrames { rx: None };
        }
        table
            .by_handle
            .retain(|_, route| route.receiver_count() > 0);
        let route = table
            .by_handle
            .entry(handle)
            .or_insert_with(|| broadcast::channel(ROUTE_CAPACITY).0);
        SessionFrames {
            rx: Some(route.subscribe()),
        }
    }
}

/// The cell's one router over one hub. It owns the routing task; dropping it
/// stops the task and closes every route, so no feed waits on a router that
/// is gone.
pub struct FrameRouter {
    routes: Arc<Routes>,
    task: tokio::task::JoinHandle<()>,
}

impl FrameRouter {
    /// Subscribes to `hub` BEFORE it spawns the routing task, so no packet
    /// published after `new` returns is missed. Needs a tokio runtime context.
    pub fn new(hub: &FrameHub) -> Self {
        let (frames, _baseline) = hub.subscribe();
        let routes = Arc::new(Routes::default());
        let task = tokio::spawn(route_frames(frames, routes.clone()));
        Self { routes, task }
    }

    /// The feed of one session's frames: a cheap handle on its route, which
    /// holds nothing until it subscribes.
    pub fn feed(&self, session_handle: u64) -> FrameFeed {
        FrameFeed {
            routes: self.routes.clone(),
            session_handle,
        }
    }
}

impl Drop for FrameRouter {
    fn drop(&mut self) {
        self.task.abort();
        self.routes.close();
    }
}

async fn route_frames(mut hub: broadcast::Receiver<FramePacket>, routes: Arc<Routes>) {
    loop {
        match hub.recv().await {
            Ok(packet) => routes.route(packet),
            Err(broadcast::error::RecvError::Lagged(_)) => routes.gap(),
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
    routes.close();
}

/// One session's frames, as a pump holds them: its route, never the cell's
/// session set.
#[derive(Clone)]
pub struct FrameFeed {
    routes: Arc<Routes>,
    session_handle: u64,
}

impl FrameFeed {
    /// Every packet of this session routed after this call. On a closed
    /// router, frames that answer `Closed` at once.
    pub fn subscribe(&self) -> SessionFrames {
        self.routes.subscribe(self.session_handle)
    }
}

/// A live subscription to one session's frames.
pub struct SessionFrames {
    /// None: the router had closed before the subscribe.
    rx: Option<broadcast::Receiver<Routed>>,
}

impl SessionFrames {
    /// The next frame of this session. Cancel-safe: the pump selects on it.
    pub async fn recv(&mut self) -> Result<FramePacket, FrameLoss> {
        let Some(rx) = self.rx.as_mut() else {
            return Err(FrameLoss::Closed);
        };
        match rx.recv().await {
            Ok(Routed::Frame(packet)) => Ok(packet),
            Ok(Routed::Gap) | Err(broadcast::error::RecvError::Lagged(_)) => Err(FrameLoss::Lost),
            Err(broadcast::error::RecvError::Closed) => Err(FrameLoss::Closed),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A packet the hub can route: it reads only the handle at byte 8.
    fn frame(session_handle: u64) -> Vec<u8> {
        let mut frame = vec![0_u8; 64];
        frame[8..16].copy_from_slice(&session_handle.to_le_bytes());
        frame
    }

    #[tokio::test]
    async fn a_route_carries_only_its_own_sessions_frames() {
        let hub = FrameHub::new(32);
        let router = FrameRouter::new(&hub);
        let mut eleven = router.feed(11).subscribe();
        let mut twenty_two = router.feed(22).subscribe();
        hub.publish(frame(22));
        hub.publish(frame(11));

        let theirs = twenty_two.recv().await.unwrap();
        assert_eq!((theirs.ordinal, theirs.session_handle), (1, 22));
        let ours = eleven.recv().await.unwrap();
        assert_eq!((ours.ordinal, ours.session_handle), (2, 11));
        // 11's packet was routed after 22's, so nothing else is on 11's route.
        assert!(matches!(
            eleven.rx.as_mut().unwrap().try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        ));
    }

    /// Current-thread: the routing task first runs at the yield, after the
    /// first packet was published, so that packet arrives only because `new`
    /// subscribed to the hub before it spawned the task. A router that
    /// subscribed from its task would read the second packet first.
    #[tokio::test]
    async fn a_packet_published_right_after_subscribe_is_received() {
        let hub = FrameHub::new(32);
        let router = FrameRouter::new(&hub);
        let mut frames = router.feed(11).subscribe();
        hub.publish(frame(11));
        tokio::task::yield_now().await;
        hub.publish(frame(11));
        assert_eq!(frames.recv().await.unwrap().ordinal, 1);
        assert_eq!(frames.recv().await.unwrap().ordinal, 2);
    }

    /// The routing task itself fell behind the hub (current-thread: it cannot
    /// run until this test awaits, and five packets overrun two slots). Whose
    /// frames it lost is not knowable, so every route reads a loss; what the
    /// hub still held is routed as usual.
    #[tokio::test]
    async fn a_router_lag_delivers_a_gap_to_every_route() {
        let hub = FrameHub::new(2);
        let router = FrameRouter::new(&hub);
        let mut eleven = router.feed(11).subscribe();
        let mut twenty_two = router.feed(22).subscribe();
        for _ in 0..5 {
            hub.publish(frame(11));
        }

        assert_eq!(eleven.recv().await.unwrap_err(), FrameLoss::Lost);
        assert_eq!(twenty_two.recv().await.unwrap_err(), FrameLoss::Lost);
        assert_eq!(eleven.recv().await.unwrap().ordinal, 4);
        assert_eq!(eleven.recv().await.unwrap().ordinal, 5);
    }

    #[tokio::test]
    async fn a_route_with_no_receiver_is_pruned_on_its_next_packet() {
        let hub = FrameHub::new(32);
        let router = FrameRouter::new(&hub);
        let eleven = router.feed(11).subscribe();
        let mut marker = router.feed(99).subscribe();
        // 11's last receiver leaves after the last subscribe, so only its own
        // next packet can prune its route.
        drop(eleven);
        hub.publish(frame(11));
        hub.publish(frame(99));
        // Routed in order: once 99's marker is out, 11's packet was routed.
        marker.recv().await.unwrap();

        let table = router.routes.table.lock().unwrap();
        let routed: Vec<u64> = table.by_handle.keys().copied().collect();
        assert_eq!(routed, vec![99], "a route nobody holds is pruned");
    }

    /// A session that ended unwatched publishes no packet that would prune its
    /// route, so the next subscribe, to any route, prunes it.
    #[tokio::test]
    async fn a_route_with_no_receiver_is_pruned_at_the_next_subscribe() {
        let hub = FrameHub::new(32);
        let router = FrameRouter::new(&hub);
        drop(router.feed(11).subscribe());
        let _twenty_two = router.feed(22).subscribe();

        let table = router.routes.table.lock().unwrap();
        let routed: Vec<u64> = table.by_handle.keys().copied().collect();
        assert_eq!(
            routed,
            vec![22],
            "a route nobody holds is pruned at the next subscribe"
        );
    }

    #[tokio::test]
    async fn a_router_whose_hub_closed_answers_closed_to_a_later_subscribe() {
        let hub = FrameHub::new(32);
        let router = FrameRouter::new(&hub);
        let mut before = router.feed(11).subscribe();
        // the hub's last sender goes; the router reads `Closed` and closes
        drop(hub);
        assert_eq!(before.recv().await.unwrap_err(), FrameLoss::Closed);

        let mut after = router.feed(11).subscribe();
        assert!(after.rx.is_none(), "a closed router opens no route");
        assert_eq!(after.recv().await.unwrap_err(), FrameLoss::Closed);
    }
}
