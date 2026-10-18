//! FW (v0.3 §5) — the link's writer: which frame goes next. Pure: the link task queues
//! messages, asks for the next frame, writes it, and reports what the peer acknowledged.
//!
//! - **The classes (FW-L7).** P0 `urgent` drains strictly first. P1 `live`, P2 `sync` and P3
//!   `bulk` share what is left by deficit round-robin, 8:2:1 by bytes, each class's quantum a
//!   multiple of the largest fragment so every round moves every busy class.
//! - **The end-to-end in-flight cap.** Bytes written and not yet acknowledged (`Ack`) stay at or
//!   below the link's cap: the caller sets it from the path (max(64 KiB, 1.25 × min-RTT ×
//!   delivery rate)), and below the floor it never goes. P0 bypasses the cap; every byte counts.
//! - **A stream's order is never broken.** Each stream is one FIFO — its OPEN, its messages
//!   fragment by fragment, its CLOSE — and a class change (the phone's `Priority`) moves the
//!   whole stream; its CLOSE (or OPEN_REFUSED) is its last frame, after which the stream is over
//!   here. The cell's own writer once let a delta overtake its activation's catch-up
//!   (the focus audit's C1); this writer reorders only ACROSS streams.
//! - **Fragments** are sized by the caller to about 5 ms of the path, clamped to
//!   `FREEWAY.MIN_FRAGMENT_BYTES`…`FREEWAY.FRAGMENT_BYTES`.
//! - **WINDOW.** A windowed stream (every kind but a terminal leg) starts a fragment only while
//!   its window is above zero, overdrawing by at most that one fragment; a grant reopens it.
//!   A terminal leg runs on TPv3's own credits and has no window here.

use super::frame::{encode, Frame, FrameType};
use crate::registries::freeway as limits;
use std::collections::{HashMap, VecDeque};

/// The traffic classes, in drain order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Class {
    Urgent,
    Live,
    Sync,
    Bulk,
}

impl Class {
    fn index(self) -> usize {
        match self {
            Self::Urgent => 0,
            Self::Live => 1,
            Self::Sync => 2,
            Self::Bulk => 3,
        }
    }
}

/// The deficit round-robin's weights for P1, P2, P3 (8:2:1 by bytes).
const WEIGHTS: [u64; 3] = [8, 2, 1];

/// One frame's worth of a stream's queue: a whole control frame (OPEN, OPENED, CLOSE,
/// OPEN_REFUSED), or a TEXT/BINARY message written out fragment by fragment.
struct Queued {
    kind: FrameType,
    payload: Vec<u8>,
    sent: usize,
}

struct Stream {
    class: Class,
    /// Bytes the peer has granted (`None`: not windowed — a terminal leg).
    window: Option<i64>,
    queue: VecDeque<Queued>,
}

pub struct Writer {
    streams: HashMap<u64, Stream>,
    /// Streams with something to write, per class, in round-robin order.
    rings: [VecDeque<u64>; 4],
    /// Stream 0's LINK messages and every WINDOW grant: urgent, ahead of any stream.
    link: VecDeque<Vec<u8>>,
    deficits: [u64; 3],
    /// The DRR's current class among P1..P3.
    turn: usize,
    fragment_bytes: usize,
    cap: u64,
    written: u64,
    acked: u64,
}

impl Default for Writer {
    fn default() -> Self {
        Self::new()
    }
}

impl Writer {
    pub fn new() -> Self {
        Self {
            streams: HashMap::new(),
            rings: Default::default(),
            link: VecDeque::new(),
            deficits: [0; 3],
            turn: 0,
            fragment_bytes: limits::FRAGMENT_BYTES as usize,
            cap: limits::WATERMARK_BYTES,
            written: 0,
            acked: 0,
        }
    }

    /// A stream begins (its OPEN is the first thing queued on it). `windowed` is false for a
    /// terminal leg alone.
    pub fn open(&mut self, stream: u64, class: Class, windowed: bool) {
        let window = windowed.then_some(limits::STREAM_WINDOW_BYTES as i64);
        self.streams.insert(
            stream,
            Stream {
                class,
                window,
                queue: VecDeque::new(),
            },
        );
    }

    /// Queue one frame or message on a stream, behind everything already queued on it.
    pub fn queue(&mut self, stream: u64, kind: FrameType, payload: Vec<u8>) {
        let Some(state) = self.streams.get_mut(&stream) else {
            return;
        };
        let was_idle = state.queue.is_empty();
        state.queue.push_back(Queued {
            kind,
            payload,
            sent: 0,
        });
        if was_idle {
            self.rings[state.class.index()].push_back(stream);
        }
    }

    /// A LINK message (stream 0) or a WINDOW grant, already encoded: urgent, in order.
    pub fn queue_link(&mut self, frame: Vec<u8>) {
        self.link.push_back(frame);
    }

    /// The phone's `Priority`: the whole stream moves — what it has queued keeps its order.
    pub fn reclass(&mut self, stream: u64, class: Class) {
        let Some(state) = self.streams.get_mut(&stream) else {
            return;
        };
        if state.class == class {
            return;
        }
        let from = state.class.index();
        state.class = class;
        if let Some(at) = self.rings[from].iter().position(|&id| id == stream) {
            self.rings[from].remove(at);
            self.rings[class.index()].push_back(stream);
        }
    }

    /// The peer's WINDOW for a windowed stream.
    pub fn grant(&mut self, stream: u64, bytes: u64) {
        if let Some(Stream {
            window: Some(window),
            ..
        }) = self.streams.get_mut(&stream)
        {
            *window = window.saturating_add(i64::try_from(bytes).unwrap_or(i64::MAX));
        }
    }

    /// The stream is over: whatever it still had queued is not written.
    pub fn forget(&mut self, stream: u64) {
        if let Some(state) = self.streams.remove(&stream) {
            self.rings[state.class.index()].retain(|&id| id != stream);
        }
    }

    /// The link's in-flight cap, never below `FREEWAY.WATERMARK_BYTES`.
    pub fn set_cap(&mut self, bytes: u64) {
        self.cap = bytes.max(limits::WATERMARK_BYTES);
    }

    /// The fragment size for this path, clamped to the registry's bounds.
    pub fn set_fragment_bytes(&mut self, bytes: usize) {
        let floor = limits::MIN_FRAGMENT_BYTES as usize;
        let ceiling = limits::FRAGMENT_BYTES as usize;
        self.fragment_bytes = bytes.clamp(floor, ceiling);
    }

    /// The peer's cumulative delivered bytes (`Ack`, or a Pong's `ackBytes`). An older count is
    /// a reorder and changes nothing, and a count past what was written is held to it. Answers the
    /// count this writer now takes as delivered — the one the path may learn a rate from.
    pub fn acked(&mut self, delivered: u64) -> u64 {
        self.acked = self.acked.max(delivered.min(self.written));
        self.acked
    }

    pub fn in_flight(&self) -> u64 {
        self.written - self.acked
    }

    /// The next frame to write, or `None` when nothing may go now — nothing queued, every
    /// windowed stream at zero, or P1–P3 waiting on the cap.
    pub fn next_frame(&mut self) -> Option<Vec<u8>> {
        let frame = self
            .next_link()
            .or_else(|| self.next_from(Class::Urgent))
            .or_else(|| {
                if self.in_flight() >= self.cap {
                    None
                } else {
                    self.next_shared()
                }
            })?;
        self.written += frame.len() as u64;
        Some(frame)
    }

    fn next_link(&mut self) -> Option<Vec<u8>> {
        self.link.pop_front()
    }

    /// P1..P3 by deficit round-robin. A class's deficit grows by its quantum when its turn
    /// comes with too little to send its head frame, and resets when it has nothing eligible.
    fn next_shared(&mut self) -> Option<Vec<u8>> {
        let quantum = self.fragment_bytes as u64 * 2;
        // Two passes give every eligible class its quantum at least once.
        for _ in 0..(2 * WEIGHTS.len()) {
            let class = [Class::Live, Class::Sync, Class::Bulk][self.turn];
            match self.head_cost(class) {
                None => {
                    self.deficits[self.turn] = 0;
                    self.turn = (self.turn + 1) % WEIGHTS.len();
                }
                Some(cost) if cost <= self.deficits[self.turn] => {
                    self.deficits[self.turn] -= cost;
                    return self.next_from(class);
                }
                Some(_) => {
                    self.deficits[self.turn] += WEIGHTS[self.turn] * quantum;
                    self.turn = (self.turn + 1) % WEIGHTS.len();
                }
            }
        }
        None
    }

    /// What the class's next frame would cost, if a stream of it may write now.
    fn head_cost(&mut self, class: Class) -> Option<u64> {
        let index = class.index();
        for _ in 0..self.rings[index].len() {
            let stream = *self.rings[index].front()?;
            let state = self.streams.get(&stream)?;
            if state.window.is_none_or(|window| window > 0) {
                let head = state.queue.front()?;
                let left = head.payload.len() - head.sent;
                return Some(left.min(self.fragment_bytes) as u64 + 11);
            }
            // At zero: wait for a grant, behind the class's other streams.
            self.rings[index].rotate_left(1);
        }
        None
    }

    /// One frame from the class's front stream; the stream goes to the back of its ring while it
    /// still has frames queued (round-robin among a class's streams).
    fn next_from(&mut self, class: Class) -> Option<Vec<u8>> {
        let index = class.index();
        for _ in 0..self.rings[index].len() {
            let stream = self.rings[index].pop_front()?;
            let fragment_bytes = self.fragment_bytes;
            let state = self.streams.get_mut(&stream)?;
            if state.window.is_some_and(|window| window <= 0) {
                self.rings[index].push_back(stream);
                continue;
            }
            let head = state.queue.front_mut()?;
            let last = matches!(head.kind, FrameType::Close | FrameType::OpenRefused);
            let frame = if head.kind == FrameType::Text || head.kind == FrameType::Binary {
                let end = (head.sent + fragment_bytes).min(head.payload.len());
                let chunk = &head.payload[head.sent..end];
                let fragment = end < head.payload.len();
                let bytes = encode(&Frame {
                    kind: head.kind,
                    fragment,
                    stream,
                    payload: chunk,
                });
                if let Some(window) = state.window.as_mut() {
                    *window -= chunk.len() as i64;
                }
                head.sent = end;
                bytes
            } else {
                head.sent = head.payload.len();
                encode(&Frame {
                    kind: head.kind,
                    fragment: false,
                    stream,
                    payload: &head.payload,
                })
            };
            if head.sent >= head.payload.len() {
                state.queue.pop_front();
            }
            if last {
                self.streams.remove(&stream);
            } else if !state.queue.is_empty() {
                self.rings[index].push_back(stream);
            }
            // A frame the codec refuses is this build's fault, never the peer's to read: it is
            // not written, and the next stream's frame goes instead.
            match frame {
                Ok(bytes) => return Some(bytes),
                Err(_) => continue,
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::freeway::frame::{decode, Message, Reassembly};

    fn drain(writer: &mut Writer) -> Vec<Vec<u8>> {
        std::iter::from_fn(|| writer.next_frame()).collect()
    }

    fn streams_of(frames: &[Vec<u8>]) -> Vec<u64> {
        frames.iter().map(|f| decode(f).unwrap().stream).collect()
    }

    #[test]
    fn the_link_and_urgent_streams_drain_strictly_first() {
        let mut writer = Writer::new();
        writer.open(1, Class::Bulk, false);
        writer.open(3, Class::Urgent, false);
        writer.queue(1, FrameType::Binary, vec![1; 100]);
        writer.queue(3, FrameType::Text, b"keys".to_vec());
        writer.queue_link(
            encode(&Frame {
                kind: FrameType::Link,
                fragment: false,
                stream: 0,
                payload: b"{}",
            })
            .unwrap(),
        );
        assert_eq!(streams_of(&drain(&mut writer)), vec![0, 3, 1]);
    }

    #[test]
    fn a_streams_frames_never_change_order_across_fragments_classes_and_its_close() {
        let mut writer = Writer::new();
        writer.set_fragment_bytes(4_096);
        writer.open(1, Class::Sync, false);
        writer.queue(1, FrameType::Open, b"{}".to_vec());
        writer.queue(1, FrameType::Binary, vec![7; 10_000]);
        writer.queue(1, FrameType::Text, b"after".to_vec());
        writer.queue(1, FrameType::Close, b"{\"code\":1000}".to_vec());
        let first = writer.next_frame().unwrap();
        assert_eq!(decode(&first).unwrap().kind, FrameType::Open);
        writer.reclass(1, Class::Live);
        let frames = drain(&mut writer);
        let kinds: Vec<_> = frames.iter().map(|f| decode(f).unwrap()).collect();
        let shape: Vec<_> = kinds.iter().map(|f| (f.kind, f.fragment)).collect();
        assert_eq!(
            shape,
            vec![
                (FrameType::Binary, true),
                (FrameType::Binary, true),
                (FrameType::Binary, false),
                (FrameType::Text, false),
                (FrameType::Close, false),
            ]
        );
        let mut stream = Reassembly::new(1 << 20);
        let mut message = None;
        for frame in &kinds[..3] {
            message = stream.push(frame).unwrap();
        }
        assert_eq!(message, Some(Message::Binary(vec![7; 10_000])));
        // The CLOSE was the stream's last frame: nothing queued after it is written.
        writer.queue(1, FrameType::Text, b"after the close".to_vec());
        assert_eq!(writer.next_frame(), None);
    }

    #[test]
    fn live_sync_and_bulk_share_the_link_eight_two_one_by_bytes() {
        let mut writer = Writer::new();
        writer.set_cap(u64::MAX);
        writer.set_fragment_bytes(4_096);
        for (stream, class) in [(1, Class::Live), (3, Class::Sync), (5, Class::Bulk)] {
            writer.open(stream, class, false);
            for _ in 0..1_000 {
                writer.queue(stream, FrameType::Binary, vec![0; 4_096]);
            }
        }
        let mut bytes: HashMap<u64, u64> = HashMap::new();
        for _ in 0..550 {
            let frame = writer.next_frame().unwrap();
            *bytes.entry(decode(&frame).unwrap().stream).or_default() += frame.len() as u64;
        }
        let (live, sync, bulk) = (bytes[&1] as f64, bytes[&3] as f64, bytes[&5] as f64);
        assert!(
            (live / bulk - 8.0).abs() < 0.5,
            "live:bulk = {}",
            live / bulk
        );
        assert!(
            (sync / bulk - 2.0).abs() < 0.25,
            "sync:bulk = {}",
            sync / bulk
        );
    }

    #[test]
    fn the_cap_holds_back_live_sync_and_bulk_never_urgent_and_an_ack_reopens_it() {
        let mut writer = Writer::new();
        writer.set_fragment_bytes(4_096);
        writer.open(1, Class::Live, false);
        writer.open(3, Class::Urgent, false);
        for _ in 0..40 {
            writer.queue(1, FrameType::Binary, vec![0; 4_096]);
        }
        let first = drain(&mut writer);
        assert!(writer.in_flight() >= limits::WATERMARK_BYTES);
        assert!(
            writer.in_flight() < limits::WATERMARK_BYTES + 4_096 + 16,
            "one frame past the cap at most"
        );
        writer.queue(3, FrameType::Text, b"interrupt".to_vec());
        let urgent = drain(&mut writer);
        assert_eq!(streams_of(&urgent), vec![3]);
        writer.acked(writer.in_flight() / 2);
        writer.acked(1); // a stale count changes nothing
        let more = drain(&mut writer);
        assert!(!more.is_empty());
        assert!(first.len() + more.len() < 40, "still capped after one ack");
    }

    #[test]
    fn a_windowed_stream_stops_at_zero_overdrawing_one_fragment_and_a_grant_reopens_it() {
        let mut writer = Writer::new();
        writer.set_cap(u64::MAX);
        writer.set_fragment_bytes(65_536);
        writer.open(2, Class::Bulk, true);
        writer.open(4, Class::Bulk, true);
        writer.queue(2, FrameType::Binary, vec![0; 3 * 1024 * 1024]);
        writer.queue(4, FrameType::Text, b"other stream".to_vec());
        let frames = drain(&mut writer);
        let payload: u64 = frames
            .iter()
            .map(|frame| decode(frame).unwrap())
            .filter(|f| f.stream == 2)
            .map(|f| f.payload.len() as u64)
            .sum();
        assert_eq!(payload, limits::STREAM_WINDOW_BYTES);
        assert!(
            streams_of(&frames).contains(&4),
            "a stream at zero does not hold the others"
        );
        writer.grant(2, 65_536);
        assert_eq!(streams_of(&drain(&mut writer)), vec![2]);
    }
}
