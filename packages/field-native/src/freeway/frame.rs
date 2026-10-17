//! FW (v0.3 §5.1) — the link's frame codec. One binary WebSocket message is one frame:
//! `u8 frameType` · LEB128 `streamId` · payload. The types are the generated
//! `registries::freeway_frame` (one table with the contracts' `FREEWAY_FRAME`), and
//! `fixtures/freeway-frames.vector.json` pins the bytes on every side. Pure: no socket, and no
//! state but one stream's reassembly. A framing error is the whole link's — it closes with
//! `FREEWAY_CODES.PROTOCOL` (4400) — so every rule a reader holds is checked here, once.

use crate::registries::freeway_frame as wire;

/// The v1 frame types. LINK is stream 0's alone and stream 0 carries nothing else; TEXT and
/// BINARY carry a stream's protocol messages, fragmented when the FRAGMENT bit says so.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameType {
    Link,
    Open,
    Opened,
    Text,
    Binary,
    Close,
    Window,
    OpenRefused,
}

impl FrameType {
    pub fn byte(self) -> u8 {
        match self {
            Self::Link => wire::LINK,
            Self::Open => wire::OPEN,
            Self::Opened => wire::OPENED,
            Self::Text => wire::TEXT,
            Self::Binary => wire::BINARY,
            Self::Close => wire::CLOSE,
            Self::Window => wire::WINDOW,
            Self::OpenRefused => wire::OPEN_REFUSED,
        }
    }

    fn from_byte(byte: u8) -> Option<Self> {
        Some(match byte {
            wire::LINK => Self::Link,
            wire::OPEN => Self::Open,
            wire::OPENED => Self::Opened,
            wire::TEXT => Self::Text,
            wire::BINARY => Self::Binary,
            wire::CLOSE => Self::Close,
            wire::WINDOW => Self::Window,
            wire::OPEN_REFUSED => Self::OpenRefused,
            _ => return None,
        })
    }

    /// TEXT and BINARY alone may carry the FRAGMENT bit.
    pub fn fragments(self) -> bool {
        matches!(self, Self::Text | Self::Binary)
    }
}

/// One frame, borrowed from the message it was read from (or about to be written into one).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Frame<'a> {
    pub kind: FrameType,
    /// More fragments of this TEXT or BINARY message follow.
    pub fragment: bool,
    pub stream: u64,
    pub payload: &'a [u8],
}

/// A message that is not a v1 frame. Every one closes the link with 4400 PROTOCOL.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameError {
    Empty,
    UnknownType(u8),
    FragmentOn(FrameType),
    LinkOffStreamZero(u64),
    StreamOnZero(FrameType),
    TruncatedStreamId,
    StreamIdOverflow,
    Window,
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty => write!(f, "an empty message carries no frame type"),
            Self::UnknownType(byte) => write!(f, "frame type {byte:#04x} is not a v1 frame"),
            Self::FragmentOn(kind) => write!(f, "the FRAGMENT bit on a {kind:?} frame"),
            Self::LinkOffStreamZero(stream) => {
                write!(f, "LINK on stream {stream}: the link is stream 0's alone")
            }
            Self::StreamOnZero(kind) => {
                write!(f, "a {kind:?} frame on stream 0, which carries LINK alone")
            }
            Self::TruncatedStreamId => write!(f, "the stream id is cut short"),
            Self::StreamIdOverflow => write!(f, "the stream id overflows u64"),
            Self::Window => write!(f, "a WINDOW's payload is one LEB128 count and nothing else"),
        }
    }
}

impl std::error::Error for FrameError {}

/// Read one frame. Its payload is checked only where the frame type fixes its shape (a WINDOW's
/// count); JSON payloads are their kind's to parse.
pub fn decode(message: &[u8]) -> Result<Frame<'_>, FrameError> {
    let (&first, rest) = message.split_first().ok_or(FrameError::Empty)?;
    let fragment = first & wire::FRAGMENT_BIT != 0;
    let kind =
        FrameType::from_byte(first & !wire::FRAGMENT_BIT).ok_or(FrameError::UnknownType(first))?;
    let (stream, used) = read_leb128(rest)?;
    let frame = Frame {
        kind,
        fragment,
        stream,
        payload: &rest[used..],
    };
    check(&frame)?;
    Ok(frame)
}

/// Write one frame, held to the same rules a reader holds — so the host can never send what a
/// peer would close the link over.
pub fn encode(frame: &Frame<'_>) -> Result<Vec<u8>, FrameError> {
    check(frame)?;
    let mut out = Vec::with_capacity(1 + 10 + frame.payload.len());
    let fragment = if frame.fragment {
        wire::FRAGMENT_BIT
    } else {
        0
    };
    out.push(frame.kind.byte() | fragment);
    write_leb128(frame.stream, &mut out);
    out.extend_from_slice(frame.payload);
    Ok(out)
}

/// A WINDOW frame granting `bytes` on `stream`.
pub fn window(stream: u64, bytes: u64) -> Result<Vec<u8>, FrameError> {
    let mut payload = Vec::with_capacity(10);
    write_leb128(bytes, &mut payload);
    encode(&Frame {
        kind: FrameType::Window,
        fragment: false,
        stream,
        payload: &payload,
    })
}

/// The bytes a WINDOW frame grants.
pub fn window_grant(frame: &Frame<'_>) -> Result<u64, FrameError> {
    if frame.kind != FrameType::Window {
        return Err(FrameError::Window);
    }
    let (bytes, used) = read_leb128(frame.payload).map_err(|_| FrameError::Window)?;
    if used != frame.payload.len() {
        return Err(FrameError::Window);
    }
    Ok(bytes)
}

fn check(frame: &Frame<'_>) -> Result<(), FrameError> {
    if frame.fragment && !frame.kind.fragments() {
        return Err(FrameError::FragmentOn(frame.kind));
    }
    match (frame.kind, frame.stream) {
        (FrameType::Link, 0) => {}
        (FrameType::Link, stream) => return Err(FrameError::LinkOffStreamZero(stream)),
        (kind, 0) => return Err(FrameError::StreamOnZero(kind)),
        _ => {}
    }
    if frame.kind == FrameType::Window {
        window_grant(frame)?;
    }
    Ok(())
}

/// Unsigned LEB128: seven bits a byte, low first, the high bit set while more follow. At most
/// ten bytes, and the tenth may carry only u64's top bit.
fn read_leb128(bytes: &[u8]) -> Result<(u64, usize), FrameError> {
    let mut value = 0u64;
    for (index, &byte) in bytes.iter().enumerate().take(10) {
        let low = u64::from(byte & 0x7f);
        if index == 9 && low > 1 {
            return Err(FrameError::StreamIdOverflow);
        }
        value |= low << (7 * index);
        if byte & 0x80 == 0 {
            return Ok((value, index + 1));
        }
    }
    if bytes.len() >= 10 {
        Err(FrameError::StreamIdOverflow)
    } else {
        Err(FrameError::TruncatedStreamId)
    }
}

fn write_leb128(mut value: u64, out: &mut Vec<u8>) {
    loop {
        let low = (value & 0x7f) as u8;
        value >>= 7;
        if value == 0 {
            out.push(low);
            return;
        }
        out.push(low | 0x80);
    }
}

/// One complete message of a stream's protocol.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Message {
    Text(String),
    Binary(Vec<u8>),
}

/// Why a stream's fragments do not make a message. The stream closes; the link stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReassemblyError {
    /// A fragment of the other type arrived before the message it continues was whole.
    Interleaved { first: FrameType, then: FrameType },
    /// The message outgrew its kind's bound — the plane's own, never the link's (v0.3 §5.1).
    TooLarge { bound: usize },
    /// A whole TEXT message that is not UTF-8.
    NotUtf8,
    /// Only TEXT and BINARY frames are messages.
    NotAMessage(FrameType),
}

impl std::fmt::Display for ReassemblyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Interleaved { first, then } => {
                write!(f, "a {then:?} fragment inside a {first:?} message")
            }
            Self::TooLarge { bound } => {
                write!(f, "a message past its kind's bound of {bound} bytes")
            }
            Self::NotUtf8 => write!(f, "a TEXT message that is not UTF-8"),
            Self::NotAMessage(kind) => write!(f, "a {kind:?} frame is not a stream message"),
        }
    }
}

impl std::error::Error for ReassemblyError {}

/// One stream's message being rebuilt from its fragments, up to its kind's own bound. TEXT is
/// checked as UTF-8 only once whole: a fragment may end inside a character.
pub struct Reassembly {
    bound: usize,
    kind: Option<FrameType>,
    bytes: Vec<u8>,
}

impl Reassembly {
    pub fn new(bound: usize) -> Self {
        Self {
            bound,
            kind: None,
            bytes: Vec::new(),
        }
    }

    /// A TEXT or BINARY frame of this stream: `Some` when it completes a message.
    pub fn push(&mut self, frame: &Frame<'_>) -> Result<Option<Message>, ReassemblyError> {
        if !frame.kind.fragments() {
            return Err(ReassemblyError::NotAMessage(frame.kind));
        }
        if let Some(first) = self.kind {
            if first != frame.kind {
                return Err(ReassemblyError::Interleaved {
                    first,
                    then: frame.kind,
                });
            }
        }
        if self.bytes.len() + frame.payload.len() > self.bound {
            return Err(ReassemblyError::TooLarge { bound: self.bound });
        }
        self.bytes.extend_from_slice(frame.payload);
        if frame.fragment {
            self.kind = Some(frame.kind);
            return Ok(None);
        }
        self.kind = None;
        let bytes = std::mem::take(&mut self.bytes);
        Ok(Some(match frame.kind {
            FrameType::Text => {
                Message::Text(String::from_utf8(bytes).map_err(|_| ReassemblyError::NotUtf8)?)
            }
            _ => Message::Binary(bytes),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn vector() -> Value {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures/freeway-frames.vector.json");
        serde_json::from_str(&std::fs::read_to_string(&path).expect("vector read")).expect("json")
    }

    fn kind(name: &str) -> FrameType {
        match name {
            "LINK" => FrameType::Link,
            "OPEN" => FrameType::Open,
            "OPENED" => FrameType::Opened,
            "TEXT" => FrameType::Text,
            "BINARY" => FrameType::Binary,
            "CLOSE" => FrameType::Close,
            "WINDOW" => FrameType::Window,
            "OPEN_REFUSED" => FrameType::OpenRefused,
            other => panic!("the vector names a frame type v1 does not have: {other}"),
        }
    }

    #[test]
    fn every_vector_frame_decodes_to_its_fields_and_encodes_back_byte_for_byte() {
        let v = vector();
        let frames = v["frames"].as_array().expect("frames");
        assert!(!frames.is_empty());
        for case in frames {
            let name = case["name"].as_str().unwrap();
            let bytes = hex::decode(case["frameHex"].as_str().unwrap()).unwrap();
            let payload = hex::decode(case["payloadHex"].as_str().unwrap()).unwrap();
            let frame = decode(&bytes).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_eq!(
                frame.kind,
                kind(case["frameType"].as_str().unwrap()),
                "{name}"
            );
            assert_eq!(
                frame.fragment,
                case["fragment"].as_bool().unwrap(),
                "{name}"
            );
            assert_eq!(frame.stream, case["streamId"].as_u64().unwrap(), "{name}");
            assert_eq!(frame.payload, payload.as_slice(), "{name}");
            assert_eq!(encode(&frame).unwrap(), bytes, "{name}");
        }
    }

    #[test]
    fn every_vector_refusal_is_refused() {
        let v = vector();
        for case in v["refused"].as_array().expect("refused") {
            let name = case["name"].as_str().unwrap();
            let bytes = hex::decode(case["frameHex"].as_str().unwrap()).unwrap();
            assert!(decode(&bytes).is_err(), "{name} must not decode");
        }
    }

    #[test]
    fn the_writer_holds_the_readers_rules() {
        let open = Frame {
            kind: FrameType::Open,
            fragment: true,
            stream: 1,
            payload: b"{}",
        };
        assert_eq!(encode(&open), Err(FrameError::FragmentOn(FrameType::Open)));
        let link = Frame {
            kind: FrameType::Link,
            fragment: false,
            stream: 3,
            payload: b"{}",
        };
        assert_eq!(encode(&link), Err(FrameError::LinkOffStreamZero(3)));
        let text = Frame {
            kind: FrameType::Text,
            fragment: false,
            stream: 0,
            payload: b"hi",
        };
        assert_eq!(
            encode(&text),
            Err(FrameError::StreamOnZero(FrameType::Text))
        );
        let stray = Frame {
            kind: FrameType::Window,
            fragment: false,
            stream: 2,
            payload: &[1, 0],
        };
        assert_eq!(encode(&stray), Err(FrameError::Window));
    }

    #[test]
    fn a_window_grants_its_count_and_stream_ids_reach_u64s_top() {
        let bytes = window(2, 1 << 20).unwrap();
        assert_eq!(bytes, hex::decode("0602808040").unwrap());
        assert_eq!(window_grant(&decode(&bytes).unwrap()), Ok(1 << 20));
        let top = encode(&Frame {
            kind: FrameType::Text,
            fragment: false,
            stream: u64::MAX,
            payload: b"",
        })
        .unwrap();
        assert_eq!(top.len(), 1 + 10);
        assert_eq!(decode(&top).unwrap().stream, u64::MAX);
    }

    #[test]
    fn fragments_rebuild_one_message_and_text_is_utf8_only_when_whole() {
        let mut stream = Reassembly::new(16);
        let e_acute = "é".as_bytes();
        let first = Frame {
            kind: FrameType::Text,
            fragment: true,
            stream: 1,
            payload: &e_acute[..1],
        };
        let last = Frame {
            kind: FrameType::Text,
            fragment: false,
            stream: 1,
            payload: &e_acute[1..],
        };
        assert_eq!(stream.push(&first), Ok(None));
        assert_eq!(stream.push(&last), Ok(Some(Message::Text("é".into()))));
        let whole = Frame {
            kind: FrameType::Binary,
            fragment: false,
            stream: 1,
            payload: &[7, 8],
        };
        assert_eq!(stream.push(&whole), Ok(Some(Message::Binary(vec![7, 8]))));
    }

    #[test]
    fn a_stream_refuses_interleaved_types_an_oversize_message_and_bad_utf8() {
        let mut stream = Reassembly::new(4);
        let text = Frame {
            kind: FrameType::Text,
            fragment: true,
            stream: 1,
            payload: b"ab",
        };
        let binary = Frame {
            kind: FrameType::Binary,
            fragment: false,
            stream: 1,
            payload: b"c",
        };
        stream.push(&text).unwrap();
        assert_eq!(
            stream.push(&binary),
            Err(ReassemblyError::Interleaved {
                first: FrameType::Text,
                then: FrameType::Binary
            })
        );
        let mut bounded = Reassembly::new(4);
        let big = Frame {
            kind: FrameType::Binary,
            fragment: true,
            stream: 1,
            payload: b"abc",
        };
        bounded.push(&big).unwrap();
        assert_eq!(
            bounded.push(&big),
            Err(ReassemblyError::TooLarge { bound: 4 })
        );
        let mut utf8 = Reassembly::new(4);
        let bad = Frame {
            kind: FrameType::Text,
            fragment: false,
            stream: 1,
            payload: &[0xff],
        };
        assert_eq!(utf8.push(&bad), Err(ReassemblyError::NotUtf8));
        let open = Frame {
            kind: FrameType::Open,
            fragment: false,
            stream: 1,
            payload: b"{}",
        };
        assert_eq!(
            utf8.push(&open),
            Err(ReassemblyError::NotAMessage(FrameType::Open))
        );
    }
}
