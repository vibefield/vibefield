//! RV #47 (native-terminal-1) — the LIFETIME LEASH a supervised child reads: its stdin, line by
//! line, on a std thread of its own. The cell (`cell.rs`) and the freeway host (`freeway/host.rs`)
//! both read line 1 as their bootstrap and every later line as an update, and the leash's end is
//! the floor's word to drain.
//!
//! Why a thread and not `tokio::io::stdin`: tokio reads stdin on its blocking pool, and that read
//! cannot be cancelled. A `select!` that ends any other way leaves it pending, and dropping the
//! runtime waits for every blocking-pool thread. The floor holds stdin open (it IS the leash), so
//! a cell whose serve plane failed on its own reported the failure and then never exited: its
//! PTYs alive and unreachable, and the floor's one crash signal, the cell's exit, never came. The
//! thread here belongs to no runtime, so dropping one never waits on it, and std never joins it:
//! whatever ends a process's `main`, the process ends.

use std::io::BufRead;
use tokio::sync::mpsc;

/// Lines read and not yet taken. The floor writes a child few lines over its life (a revoke, a
/// declaration), so the bound only paces the thread; stdin's own pipe holds the rest.
const UNREAD_LINES: usize = 8;

/// The leash, as its holder reads it: `next_line` until it answers `None`.
pub struct Leash {
    lines: mpsc::Receiver<String>,
}

impl Leash {
    /// This process's stdin, read on the `field-native-leash` thread. It is stdin's one reader:
    /// nothing else in a process that takes a leash reads stdin.
    pub fn stdin() -> Leash {
        read_on_a_thread(|| std::io::stdin().lock())
    }

    /// Any reader, read on a thread of its own as `stdin` reads stdin (the unit rows' pipe).
    pub fn from_reader(reader: impl BufRead + Send + 'static) -> Leash {
        read_on_a_thread(move || reader)
    }

    /// In-process: each line is sent whole, and dropping the sender ends the leash.
    pub fn channel() -> (mpsc::Sender<String>, Leash) {
        let (sender, lines) = mpsc::channel(UNREAD_LINES);
        (sender, Leash { lines })
    }

    /// The next line, without its line ending. `None` once the leash has ended (its writer closed
    /// it, or a read failed, said once on the thread), which is the ask to drain. Cancel-safe: a
    /// `select!` that drops it loses no line.
    pub async fn next_line(&mut self) -> Option<String> {
        self.lines.recv().await
    }
}

/// The thread. `open` runs on it, so a reader that cannot cross threads (stdin's lock) never has
/// to. Each line goes to the leash until the end, a failed read, or a leash no one holds. A thread
/// that does not start is said, and its leash reads as ended.
fn read_on_a_thread<R, F>(open: F) -> Leash
where
    R: BufRead + 'static,
    F: FnOnce() -> R + Send + 'static,
{
    let (sender, leash) = Leash::channel();
    let started = std::thread::Builder::new()
        .name("field-native-leash".to_owned())
        .spawn(move || {
            for line in open().lines() {
                match line {
                    // Not a runtime thread, so a blocking send is legal here. It fails only once
                    // the leash is dropped, when no one is listening.
                    Ok(line) => {
                        if sender.blocking_send(line).is_err() {
                            return;
                        }
                    }
                    Err(error) => {
                        tracing::warn!(
                            event = "field_native.leash.read_failed",
                            component = "lifecycle",
                            error = %error,
                            "the leash's read failed; it reads as ended"
                        );
                        return;
                    }
                }
            }
        });
    if let Err(error) = started {
        tracing::error!(
            event = "field_native.leash.thread_failed",
            component = "lifecycle",
            error = %error,
            "the leash's thread did not start; it reads as ended"
        );
    }
    leash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lines_arrive_whole_and_in_order_and_the_end_reads_none() {
        let lines = std::io::Cursor::new(b"one\r\ntwo\nthree".to_vec());
        let mut leash = Leash::from_reader(lines);
        for expected in ["one", "two", "three"] {
            assert_eq!(leash.next_line().await.as_deref(), Some(expected));
        }
        assert_eq!(leash.next_line().await, None);
    }

    /// The property the cell's crash path stands on: a leash whose writer never closes holds
    /// nothing of the runtime. Polled in a `select!` that it loses, it leaves no read behind on
    /// the runtime's blocking pool (tokio's stdin leaves one there, uncancellable), so dropping
    /// the runtime returns while the writer is still open.
    #[cfg(unix)]
    #[test]
    fn a_runtime_whose_leash_lost_a_select_drops_while_its_writer_stays_open() {
        use std::os::unix::net::UnixStream;
        use std::time::Duration;

        let (writer, reader) = UnixStream::pair().expect("a socket pair");
        let mut leash = Leash::from_reader(std::io::BufReader::new(reader));
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("a runtime");
        let won = runtime.block_on(async {
            tokio::select! {
                biased;
                line = leash.next_line() => Some(line),
                () = std::future::ready(()) => None,
            }
        });
        assert!(won.is_none(), "the leash had no line to give: {won:?}");
        let (done, dropped) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            drop(runtime);
            let _ = done.send(());
        });
        dropped
            .recv_timeout(Duration::from_secs(5))
            .expect("the runtime drops while the leash's writer is open");
        drop(writer);
    }
}
