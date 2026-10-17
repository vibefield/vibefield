//! FW (v0.3 §5.1) — the link's streams: who may open which id, what each frame means for its
//! stream, and one message reassembled per stream. Pure: frames in, events out; the link task
//! acts on the events and hands its own frames to the `Writer`.
//!
//! - **Ids.** The dialer opens odd ids from 1, the acceptor even ids from 2, and an id is never
//!   reused within a link: a peer's OPEN must name a new id of ITS parity, above every one it has
//!   named. A frame for an id the peer never opened is a protocol error; one for a stream that has
//!   since closed is a frame that crossed the close in flight, and is dropped.
//! - **The kind decides the stream.** An OPEN's payload is the kind's (`FreewayOpen`); the caller's
//!   `spec` reads it and says whether the stream is windowed (every kind but a terminal leg) and
//!   its message bound (the plane's own, never the link's), or refuses it.
//! - **Optimistic open.** TEXT and BINARY may follow an OPEN at once. On a stream THIS side opened,
//!   the peer's data comes only after its OPENED.
//! - **WINDOW, receiving.** A windowed stream's sender may run `FREEWAY.STREAM_WINDOW_BYTES` ahead;
//!   as this side delivers to its local door it grants credit back, half a window at a time.
//! - **Close.** Each side sends one CLOSE (the stream's protocol code, verbatim). After the peer's,
//!   nothing more may arrive on the stream; with both sent, the stream is gone.

use super::frame::{
    decode, window, Frame, FrameError, FrameType, Message, Reassembly, ReassemblyError,
};
use crate::registries::freeway as limits;
use std::collections::HashMap;

/// Which end of the link this is — the parity of the ids it opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Dialer,
    Acceptor,
}

/// What a stream's kind makes of it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamSpec {
    /// False for a terminal leg alone: it runs on TPv3's own credits.
    pub windowed: bool,
    /// The largest message the stream's plane sends, in bytes.
    pub message_bound: usize,
}

/// What one frame meant.
#[derive(Debug, PartialEq, Eq)]
pub enum Event<'a> {
    /// A stream-0 message (`FreewayLinkMessage`, JSON).
    Link(&'a [u8]),
    /// The peer opened a stream the spec accepted (its `FreewayOpen` payload).
    Opened {
        stream: u64,
        open: &'a [u8],
        spec: StreamSpec,
    },
    /// The peer opened a stream the spec refused: answer OPEN_REFUSED (4404 `KIND_NOT_SERVED`).
    NotServed { stream: u64, open: &'a [u8] },
    /// A stream this side opened was answered (`FreewayOpened`).
    Answered { stream: u64, answer: &'a [u8] },
    /// A stream this side opened was refused by the far host (`FreewayOpenRefused`); it is gone.
    Refused { stream: u64, refusal: &'a [u8] },
    /// One whole message of the stream's protocol.
    Message { stream: u64, message: Message },
    /// A fragment of a message not yet whole.
    Pending { stream: u64 },
    /// The peer's CLOSE (`FreewayClose`).
    Closed { stream: u64, close: &'a [u8] },
    /// The peer granted this many bytes on a windowed stream this side writes (for the writer).
    Window { stream: u64, bytes: u64 },
    /// A frame for a stream that has closed: it crossed the close in flight.
    Late { stream: u64 },
}

/// Why the link closes (4400 PROTOCOL), or one stream does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MuxError {
    /// Not a v1 frame.
    Frame(FrameError),
    /// The peer opened an id of this side's parity, or one it had already named.
    BadOpen(u64),
    /// A frame for an id the peer never opened.
    NeverOpened(u64),
    /// The peer's data on a stream this side opened, before the peer answered it.
    BeforeAnswer(u64),
    /// A frame after the peer's own CLOSE of the stream.
    AfterClose(u64),
    /// More streams than `FREEWAY.MAX_STREAMS` at once.
    TooManyStreams,
    /// The stream's message did not reassemble — that stream closes; the link stands.
    Message { stream: u64, error: ReassemblyError },
}

impl std::fmt::Display for MuxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Frame(error) => write!(f, "{error}"),
            Self::BadOpen(stream) => {
                write!(f, "an OPEN of stream {stream}, not the peer's to open")
            }
            Self::NeverOpened(stream) => write!(f, "a frame for stream {stream}, never opened"),
            Self::BeforeAnswer(stream) => write!(f, "data on stream {stream} before its OPENED"),
            Self::AfterClose(stream) => write!(f, "a frame on stream {stream} after its CLOSE"),
            Self::TooManyStreams => write!(f, "more than {} streams at once", limits::MAX_STREAMS),
            Self::Message { stream, error } => write!(f, "stream {stream}: {error}"),
        }
    }
}

impl std::error::Error for MuxError {}

struct Stream {
    ours: bool,
    answered: bool,
    windowed: bool,
    peer_closed: bool,
    we_closed: bool,
    reassembly: Reassembly,
    delivered_since_grant: u64,
}

pub struct Mux {
    role: Role,
    next_ours: u64,
    peer_high: u64,
    streams: HashMap<u64, Stream>,
}

impl Mux {
    pub fn new(role: Role) -> Self {
        let next_ours = match role {
            Role::Dialer => 1,
            Role::Acceptor => 2,
        };
        Self {
            role,
            next_ours,
            peer_high: 0,
            streams: HashMap::new(),
        }
    }

    fn ours(&self, stream: u64) -> bool {
        (stream % 2 == 1) == (self.role == Role::Dialer)
    }

    /// Open a stream of ours: its id, to send its OPEN on (and the data after it).
    pub fn open(&mut self, spec: StreamSpec) -> Result<u64, MuxError> {
        if self.streams.len() >= limits::MAX_STREAMS as usize {
            return Err(MuxError::TooManyStreams);
        }
        let stream = self.next_ours;
        self.next_ours += 2;
        self.streams.insert(stream, Stream::new(true, spec));
        Ok(stream)
    }

    /// This side sent its CLOSE of the stream.
    pub fn close(&mut self, stream: u64) {
        if let Some(state) = self.streams.get_mut(&stream) {
            state.we_closed = true;
            if state.peer_closed {
                self.streams.remove(&stream);
            }
        }
    }

    /// This side delivered `bytes` of the stream to its local door: the WINDOW frame to send, once
    /// half a window has been delivered since the last.
    pub fn delivered(&mut self, stream: u64, bytes: u64) -> Option<Vec<u8>> {
        let state = self.streams.get_mut(&stream)?;
        if !state.windowed {
            return None;
        }
        state.delivered_since_grant += bytes;
        if state.delivered_since_grant < limits::STREAM_WINDOW_BYTES / 2 {
            return None;
        }
        let grant = std::mem::take(&mut state.delivered_since_grant);
        window(stream, grant).ok()
    }

    /// What one message from the peer means. `spec` reads a peer's OPEN.
    pub fn receive<'a>(
        &mut self,
        message: &'a [u8],
        spec: impl FnOnce(&[u8]) -> Option<StreamSpec>,
    ) -> Result<Event<'a>, MuxError> {
        let frame = decode(message).map_err(MuxError::Frame)?;
        match frame.kind {
            FrameType::Link => Ok(Event::Link(frame.payload)),
            FrameType::Open => self.peer_open(&frame, spec),
            _ => self.on_stream(&frame),
        }
    }

    fn peer_open<'a>(
        &mut self,
        frame: &Frame<'a>,
        spec: impl FnOnce(&[u8]) -> Option<StreamSpec>,
    ) -> Result<Event<'a>, MuxError> {
        let stream = frame.stream;
        if self.ours(stream) || stream <= self.peer_high {
            return Err(MuxError::BadOpen(stream));
        }
        self.peer_high = stream;
        let Some(accepted) = spec(frame.payload) else {
            return Ok(Event::NotServed {
                stream,
                open: frame.payload,
            });
        };
        if self.streams.len() >= limits::MAX_STREAMS as usize {
            return Err(MuxError::TooManyStreams);
        }
        self.streams.insert(stream, Stream::new(false, accepted));
        Ok(Event::Opened {
            stream,
            open: frame.payload,
            spec: accepted,
        })
    }

    fn on_stream<'a>(&mut self, frame: &Frame<'a>) -> Result<Event<'a>, MuxError> {
        let stream = frame.stream;
        let Some(state) = self.streams.get_mut(&stream) else {
            let named = if self.ours(stream) {
                stream < self.next_ours
            } else {
                stream <= self.peer_high
            };
            return if named {
                Ok(Event::Late { stream })
            } else {
                Err(MuxError::NeverOpened(stream))
            };
        };
        if state.peer_closed {
            return Err(MuxError::AfterClose(stream));
        }
        match frame.kind {
            FrameType::Opened | FrameType::OpenRefused if !state.ours || state.answered => {
                Err(MuxError::BadOpen(stream))
            }
            FrameType::Opened => {
                state.answered = true;
                Ok(Event::Answered {
                    stream,
                    answer: frame.payload,
                })
            }
            FrameType::OpenRefused => {
                self.streams.remove(&stream);
                Ok(Event::Refused {
                    stream,
                    refusal: frame.payload,
                })
            }
            FrameType::Text | FrameType::Binary => {
                if state.ours && !state.answered {
                    return Err(MuxError::BeforeAnswer(stream));
                }
                match state.reassembly.push(frame) {
                    Ok(Some(message)) => Ok(Event::Message { stream, message }),
                    Ok(None) => Ok(Event::Pending { stream }),
                    Err(error) => Err(MuxError::Message { stream, error }),
                }
            }
            FrameType::Close => {
                state.peer_closed = true;
                if state.we_closed {
                    self.streams.remove(&stream);
                }
                Ok(Event::Closed {
                    stream,
                    close: frame.payload,
                })
            }
            FrameType::Window => {
                let bytes = super::frame::window_grant(frame).map_err(MuxError::Frame)?;
                Ok(Event::Window { stream, bytes })
            }
            FrameType::Link | FrameType::Open => unreachable!("routed by `receive`"),
        }
    }
}

impl Stream {
    fn new(ours: bool, spec: StreamSpec) -> Self {
        Self {
            ours,
            answered: !ours,
            windowed: spec.windowed,
            peer_closed: false,
            we_closed: false,
            reassembly: Reassembly::new(spec.message_bound),
            delivered_since_grant: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::freeway::frame::encode;

    const TERMINAL: StreamSpec = StreamSpec {
        windowed: false,
        message_bound: 4 << 20,
    };
    const PRODUCT: StreamSpec = StreamSpec {
        windowed: true,
        message_bound: 1 << 20,
    };

    fn frame(kind: FrameType, stream: u64, payload: &[u8]) -> Vec<u8> {
        encode(&Frame {
            kind,
            fragment: false,
            stream,
            payload,
        })
        .unwrap()
    }

    fn serve_terminals(open: &[u8]) -> Option<StreamSpec> {
        open.starts_with(b"{\"kind\":\"terminal-leg\"")
            .then_some(TERMINAL)
    }

    #[test]
    fn each_end_opens_its_own_parity_and_never_reuses_an_id() {
        let mut dialer = Mux::new(Role::Dialer);
        let ids: Vec<_> = (0..3).map(|_| dialer.open(TERMINAL).unwrap()).collect();
        assert_eq!(ids, vec![1, 3, 5]);
        let mut acceptor = Mux::new(Role::Acceptor);
        assert_eq!(acceptor.open(PRODUCT).unwrap(), 2);
        assert_eq!(acceptor.open(PRODUCT).unwrap(), 4);
        // The acceptor's peer is the dialer: it may open odd ids, each above the last.
        let open = br#"{"kind":"terminal-leg","cellBootId":"cb-1","channel":"frames"}"#;
        assert!(matches!(
            acceptor.receive(&frame(FrameType::Open, 3, open), serve_terminals),
            Ok(Event::Opened {
                stream: 3,
                spec: TERMINAL,
                ..
            })
        ));
        for bad in [2, 3, 1] {
            assert_eq!(
                acceptor.receive(&frame(FrameType::Open, bad, open), serve_terminals),
                Err(MuxError::BadOpen(bad))
            );
        }
    }

    #[test]
    fn a_kind_the_host_does_not_serve_is_refused_and_its_id_stays_named() {
        let mut mux = Mux::new(Role::Acceptor);
        let product = br#"{"kind":"product","class":"sync"}"#;
        assert!(matches!(
            mux.receive(&frame(FrameType::Open, 1, product), serve_terminals),
            Ok(Event::NotServed { stream: 1, .. })
        ));
        // Its optimistic data crossed the refusal: dropped, never a protocol error.
        assert_eq!(
            mux.receive(&frame(FrameType::Text, 1, b"early"), |_| None),
            Ok(Event::Late { stream: 1 })
        );
        // An id the peer never named is one.
        assert_eq!(
            mux.receive(&frame(FrameType::Text, 7, b"?"), |_| None),
            Err(MuxError::NeverOpened(7))
        );
    }

    #[test]
    fn an_open_may_carry_data_at_once_but_the_far_side_answers_before_it_speaks() {
        let mut acceptor = Mux::new(Role::Acceptor);
        let open = br#"{"kind":"terminal-leg","cellBootId":"cb-1","channel":"control"}"#;
        acceptor
            .receive(&frame(FrameType::Open, 1, open), serve_terminals)
            .unwrap();
        assert_eq!(
            acceptor.receive(&frame(FrameType::Text, 1, b"hello"), |_| None),
            Ok(Event::Message {
                stream: 1,
                message: Message::Text("hello".into())
            })
        );
        let mut dialer = Mux::new(Role::Dialer);
        let ours = dialer.open(TERMINAL).unwrap();
        assert_eq!(
            dialer.receive(&frame(FrameType::Text, ours, b"too soon"), |_| None),
            Err(MuxError::BeforeAnswer(ours))
        );
        assert!(matches!(
            dialer.receive(&frame(FrameType::Opened, ours, b"{}"), |_| None),
            Ok(Event::Answered { .. })
        ));
        assert_eq!(
            dialer.receive(&frame(FrameType::Opened, ours, b"{}"), |_| None),
            Err(MuxError::BadOpen(ours))
        );
        assert!(matches!(
            dialer.receive(&frame(FrameType::Binary, ours, &[1, 2]), |_| None),
            Ok(Event::Message {
                message: Message::Binary(_),
                ..
            })
        ));
    }

    #[test]
    fn a_refused_open_is_gone_and_a_closed_stream_takes_nothing_more() {
        let mut dialer = Mux::new(Role::Dialer);
        let refused = dialer.open(TERMINAL).unwrap();
        let refusal = br#"{"code":4504,"state":"restarting","retryable":true}"#;
        assert!(matches!(
            dialer.receive(&frame(FrameType::OpenRefused, refused, refusal), |_| None),
            Ok(Event::Refused { .. })
        ));
        assert_eq!(
            dialer.receive(&frame(FrameType::Text, refused, b"x"), |_| None),
            Ok(Event::Late { stream: refused })
        );
        let stream = dialer.open(TERMINAL).unwrap();
        dialer
            .receive(&frame(FrameType::Opened, stream, b"{}"), |_| None)
            .unwrap();
        assert!(matches!(
            dialer.receive(
                &frame(FrameType::Close, stream, br#"{"code":4004}"#),
                |_| None
            ),
            Ok(Event::Closed { .. })
        ));
        assert_eq!(
            dialer.receive(&frame(FrameType::Text, stream, b"after"), |_| None),
            Err(MuxError::AfterClose(stream))
        );
        dialer.close(stream);
        assert_eq!(
            dialer.receive(&frame(FrameType::Text, stream, b"late"), |_| None),
            Ok(Event::Late { stream })
        );
    }

    #[test]
    fn a_windowed_stream_grants_back_half_a_window_at_a_time_and_reads_the_peers_grants() {
        let mut mux = Mux::new(Role::Dialer);
        let product = mux.open(PRODUCT).unwrap();
        let terminal = mux.open(TERMINAL).unwrap();
        assert_eq!(mux.delivered(product, 256 * 1024), None);
        let grant = mux
            .delivered(product, 300 * 1024)
            .expect("half a window delivered");
        assert_eq!(
            super::super::frame::window_grant(&decode(&grant).unwrap()),
            Ok(556 * 1024)
        );
        assert_eq!(
            mux.delivered(terminal, 4 << 20),
            None,
            "a terminal leg runs on TPv3's credits"
        );
        mux.receive(&frame(FrameType::Opened, product, b"{}"), |_| None)
            .unwrap();
        assert_eq!(
            mux.receive(&window(product, 65_536).unwrap(), |_| None),
            Ok(Event::Window {
                stream: product,
                bytes: 65_536
            })
        );
    }

    #[test]
    fn the_link_holds_at_most_max_streams_and_a_message_past_its_bound_is_its_streams_error() {
        let mut mux = Mux::new(Role::Dialer);
        for _ in 0..limits::MAX_STREAMS {
            mux.open(TERMINAL).unwrap();
        }
        assert_eq!(mux.open(TERMINAL), Err(MuxError::TooManyStreams));
        let mut small = Mux::new(Role::Acceptor);
        let tiny = |_: &[u8]| {
            Some(StreamSpec {
                windowed: true,
                message_bound: 4,
            })
        };
        small
            .receive(&frame(FrameType::Open, 1, b"{}"), tiny)
            .unwrap();
        assert_eq!(
            small.receive(&frame(FrameType::Binary, 1, b"too big"), |_| None),
            Err(MuxError::Message {
                stream: 1,
                error: ReassemblyError::TooLarge { bound: 4 }
            })
        );
    }
}
