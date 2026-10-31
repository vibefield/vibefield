//! CP-1a — `field-native door --endpoint <path>`: the MCP stdio server a spark's agent runs, which carries its stdio
//! to the floor's door (`services/door`). The floor names the caller by the kernel's word, so this process proves
//! nothing and carries nothing but bytes. It reads no environment and touches no data dir. Its one argument is the
//! endpoint `native.door.info` gave fieldd for the spark's MCP config.
//!
//! **It outlives a floor restart** (the CO lead's proposal, 2026-10-29). A spark's agent lives on in its pane while
//! the floor restarts, and without this its server would be gone until someone reconnected it by hand. So on the
//! socket's EOF or error, the bridge dials again while its stdin stays open, with doubling delays that spend
//! `Backoff::budget` in all. The new connection is a new door, walked again to the same pid and pane. A floor that
//! closes a door on purpose looks the same from here, so the budget is restored only by a connection that lived a
//! whole budget: a door fieldd keeps closing comes back for at most one budget, and then the bridge exits (the CO
//! lead's ruling, 2026-10-29).
//!
//! **It carries whole lines only, both ways.** MCP's stdio transport is one JSON-RPC message per line, and that is all
//! the bridge knows of it. stdin is held to each `\n`, so a connection never begins mid-line, and a line that failed
//! to go is sent first on the next one. The socket's bytes reach stdout a whole line at a time, so a connection lost
//! mid-line never hands the agent a torn line followed by the next connection's. What was in flight when a
//! connection went is lost, and the agent's client asks again on its own timeout.
//!
//! Exit codes: 0, stdin closed or stdout gone; 2, usage; 3, the door unreachable at the first dial or for a whole
//! budget; 4, a line from stdin longer than `LINE_MAX`.

use std::collections::VecDeque;
use std::time::Duration;
#[cfg(unix)]
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
#[cfg(unix)]
use tokio::sync::mpsc;

/// The longest line carried, its `\n` included: `NATIVE_DOOR.LINE_MAX_BYTES`, the bound fieldd's line reader holds
/// too (CP-1b). The floor carries a line in chunks, so the bound is the two line readers', not a frame's. A line
/// toward the agent this long with no `\n` is written as it stands: holding more would be unbounded.
pub const LINE_MAX: usize = crate::registries::native_door::LINE_MAX_BYTES as usize;

pub const EXIT_OK: i32 = 0;
pub const EXIT_USAGE: i32 = 2;
pub const EXIT_UNREACHABLE: i32 = 3;
pub const EXIT_LINE_TOO_LONG: i32 = 4;

pub const USAGE: &str = "usage: field-native door --endpoint <path>\n";

/// How the bridge dials again: the first delay, doubling, until `budget` is spent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Backoff {
    pub first: Duration,
    pub budget: Duration,
}

impl Backoff {
    /// 250 ms doubling, about 60 s in all (the CO lead's proposal).
    pub const STANDARD: Self = Self {
        first: Duration::from_millis(250),
        budget: Duration::from_secs(60),
    };

    /// The delays one budget allows, the last cut to what remains.
    pub fn delays(self) -> VecDeque<Duration> {
        let mut delays = VecDeque::new();
        let (mut next, mut spent) = (self.first, Duration::ZERO);
        while spent < self.budget && !next.is_zero() {
            let delay = next.min(self.budget - spent);
            delays.push_back(delay);
            spent += delay;
            next *= 2;
        }
        delays
    }
}

/// The `door` arm's arguments, after `door`: exactly `--endpoint <path>`.
pub fn parse_args(args: &[String]) -> Option<&str> {
    match args {
        [flag, endpoint] if flag == "--endpoint" && !endpoint.is_empty() => Some(endpoint),
        _ => None,
    }
}

/// The binary's `door` arm: the arguments after `door`, this process's stdio, and the standard backoff.
pub async fn main(args: &[String]) -> i32 {
    let Some(endpoint) = parse_args(args) else {
        eprint!("field-native door: expected --endpoint <path>\n\n{USAGE}");
        return EXIT_USAGE;
    };
    bridge(
        endpoint,
        tokio::io::stdin(),
        tokio::io::stdout(),
        Backoff::STANDARD,
    )
    .await
}

#[cfg(unix)]
enum Line {
    Whole(Vec<u8>),
    TooLong,
}

/// stdin cut into whole lines. A last line without its `\n` goes as it is when stdin ends, and the channel closing is
/// stdin's end.
#[cfg(unix)]
fn read_lines<R: AsyncRead + Unpin + Send + 'static>(input: R) -> mpsc::Receiver<Line> {
    let (tx, rx) = mpsc::channel(64);
    tokio::spawn(async move {
        let mut input = BufReader::new(input);
        loop {
            let mut line = Vec::new();
            // `read_until` alone has no bound, so the cap is held by reading through a `take`
            let read = (&mut input)
                .take(LINE_MAX as u64 + 1)
                .read_until(b'\n', &mut line)
                .await;
            let line = match read {
                Ok(0) | Err(_) => return,
                Ok(_) if line.len() > LINE_MAX => Line::TooLong,
                Ok(_) => Line::Whole(line),
            };
            let too_long = matches!(line, Line::TooLong);
            if tx.send(line).await.is_err() || too_long {
                return;
            }
        }
    });
    rx
}

/// How one connection ended.
#[cfg(unix)]
enum Ended {
    /// the socket went: dial again
    Lost,
    /// the bridge is done, with this exit code
    Exit(i32),
}

/// Carry stdin and stdout to the door at `endpoint`, dialing again by `backoff`, until stdin ends. Returns the exit
/// code.
#[cfg(unix)]
pub async fn bridge<R, W>(endpoint: &str, input: R, output: W, backoff: Backoff) -> i32
where
    R: AsyncRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let output = std::sync::Arc::new(tokio::sync::Mutex::new(output));
    let mut lines = read_lines(input);
    // whole lines that wait for a connection, the one that failed to go first
    let mut waiting: VecDeque<Vec<u8>> = VecDeque::new();
    let Ok(mut stream) = tokio::net::UnixStream::connect(endpoint).await else {
        eprintln!("field-native door: the door at {endpoint} is unreachable");
        return EXIT_UNREACHABLE;
    };
    let mut delays = backoff.delays();
    loop {
        let connected = tokio::time::Instant::now();
        if let Ended::Exit(code) = carry(stream, &mut lines, &mut waiting, output.clone()).await {
            return code;
        }
        // only a connection that lived a whole budget restores the budget (the module's head says why)
        if connected.elapsed() >= backoff.budget {
            delays = backoff.delays();
        }
        stream = loop {
            let Some(delay) = delays.pop_front() else {
                eprintln!(
                    "field-native door: the door at {endpoint} was unreachable for {:?}",
                    backoff.budget
                );
                return EXIT_UNREACHABLE;
            };
            // stdin is still read while the bridge waits: its lines wait too (up to one line's bound, and past it
            // the agent's writes wait in its pipe), and its end ends the bridge
            let sleep = tokio::time::sleep(delay);
            tokio::pin!(sleep);
            loop {
                let room = waiting.iter().map(Vec::len).sum::<usize>() < LINE_MAX;
                tokio::select! {
                    _ = &mut sleep => break,
                    line = lines.recv(), if room => match line {
                        Some(Line::Whole(line)) => waiting.push_back(line),
                        Some(Line::TooLong) => return too_long(),
                        None => return EXIT_OK,
                    },
                }
            }
            if let Ok(stream) = tokio::net::UnixStream::connect(endpoint).await {
                break stream;
            }
        };
    }
}

#[cfg(not(unix))]
pub async fn bridge<R, W>(_endpoint: &str, _input: R, _output: W, _backoff: Backoff) -> i32 {
    eprintln!("field-native door: the floor's door is unix-only");
    EXIT_UNREACHABLE
}

#[cfg(unix)]
fn too_long() -> i32 {
    eprintln!("field-native door: a line on stdin is longer than {LINE_MAX} bytes");
    EXIT_LINE_TOO_LONG
}

/// One connection: whole lines out, whole lines back, until the socket goes or stdin ends.
#[cfg(unix)]
async fn carry<W>(
    stream: tokio::net::UnixStream,
    lines: &mut mpsc::Receiver<Line>,
    waiting: &mut VecDeque<Vec<u8>>,
    output: std::sync::Arc<tokio::sync::Mutex<W>>,
) -> Ended
where
    W: AsyncWrite + Unpin + Send + 'static,
{
    let (mut read, mut write) = stream.into_split();
    // toward the agent: whole lines only; a part line when the socket goes is dropped with it
    let mut toward = tokio::spawn(async move {
        let mut buf = vec![0u8; 64 * 1024];
        let mut tail: Vec<u8> = Vec::new();
        loop {
            let n = match read.read(&mut buf).await {
                Ok(0) | Err(_) => return Ended::Lost,
                Ok(n) => n,
            };
            tail.extend_from_slice(&buf[..n]);
            let cut = match tail.iter().rposition(|byte| *byte == b'\n') {
                Some(at) => at + 1,
                None if tail.len() >= LINE_MAX => tail.len(),
                None => continue,
            };
            let whole: Vec<u8> = tail.drain(..cut).collect();
            let mut out = output.lock().await;
            if out.write_all(&whole).await.is_err() || out.flush().await.is_err() {
                // stdout is gone, and with it the agent
                return Ended::Exit(EXIT_OK);
            }
        }
    });
    let ended = loop {
        while let Some(line) = waiting.front() {
            if write.write_all(line).await.is_err() {
                break;
            }
            waiting.pop_front();
        }
        if !waiting.is_empty() {
            // the socket refused a write: it is going; let the reading half say how
            break None;
        }
        tokio::select! {
            line = lines.recv() => match line {
                Some(Line::Whole(line)) => waiting.push_back(line),
                Some(Line::TooLong) => break Some(Ended::Exit(too_long())),
                None => {
                    let _ = write.shutdown().await;
                    break Some(Ended::Exit(EXIT_OK));
                }
            },
            ended = &mut toward => return ended.unwrap_or(Ended::Lost),
        }
    };
    match ended {
        Some(exit) => {
            toward.abort();
            exit
        }
        // a refused write means the floor's end is gone, so the read half meets its EOF at once; it is awaited, never
        // aborted, so a line it is writing to the agent is never torn
        None => toward.await.unwrap_or(Ended::Lost),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_standard_backoff_doubles_from_250_ms_and_spends_60_s() {
        let delays: Vec<u64> = Backoff::STANDARD
            .delays()
            .iter()
            .map(|d| d.as_millis() as u64)
            .collect();
        assert_eq!(
            delays,
            [250, 500, 1_000, 2_000, 4_000, 8_000, 16_000, 28_250]
        );
        assert_eq!(delays.iter().sum::<u64>(), 60_000);
    }

    #[test]
    fn the_door_arm_takes_exactly_its_endpoint() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            parse_args(&args(&["--endpoint", "/run/door.sock"])),
            Some("/run/door.sock")
        );
        for refused in [
            &[][..],
            &["--endpoint"],
            &["--endpoint", ""],
            &["/run/door.sock"],
            &["--endpoint", "/a", "--extra"],
        ] {
            assert_eq!(parse_args(&args(refused)), None, "{refused:?}");
        }
    }
}
