use super::{lock_recover, Emergency};
use std::fs::File;
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

const MAX_LINE_BYTES: usize = 16 * 1024;
const READ_BYTES: usize = 4 * 1024;
const MAX_EMERGENCY_BYTES: usize = 1_024;
const SIDECAR_PREFIX: &str = "[sidecar-stderr] ";

struct OriginalStderr {
    file: Mutex<File>,
}

impl OriginalStderr {
    fn write_emergency(&self, message: &str) {
        let clean = message.replace(['\r', '\n'], " ");
        let clean = truncate_utf8(&clean, MAX_EMERGENCY_BYTES);
        let mut file = lock_recover(&self.file);
        let _ = file.write_all(clean.as_bytes());
        let _ = file.write_all(b"\n");
    }

    fn restore(&self) -> io::Result<()> {
        let file = lock_recover(&self.file);
        // SAFETY: both descriptors are live for this call. `dup2` atomically
        // replaces process stderr with the retained pre-route descriptor.
        if unsafe { libc::dup2(file.as_raw_fd(), libc::STDERR_FILENO) } == -1 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}

/// Routes process stderr into the structured sink while retaining the original
/// descriptor exclusively for one-shot logging emergencies. truffle currently
/// forwards its Go sidecar's stderr with `eprintln!`; this process-owned bridge
/// keeps that evidence out of fieldd and away from the terminal/PTY route.
pub(super) struct StderrRoute {
    original: Arc<OriginalStderr>,
    reader: Option<JoinHandle<()>>,
    completed: mpsc::Receiver<()>,
    restored: bool,
}

impl StderrRoute {
    pub(super) fn install() -> io::Result<Self> {
        // SAFETY: fcntl duplicates the valid process stderr descriptor. The
        // returned descriptor is immediately wrapped in an owning `File`.
        let original_fd = unsafe { libc::fcntl(libc::STDERR_FILENO, libc::F_DUPFD_CLOEXEC, 3) };
        if original_fd == -1 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: `original_fd` is newly owned by this function.
        let original = Arc::new(OriginalStderr {
            file: Mutex::new(unsafe { File::from_raw_fd(original_fd) }),
        });

        let mut descriptors = [0; 2];
        // SAFETY: `descriptors` points to storage for both descriptors.
        if unsafe { libc::pipe(descriptors.as_mut_ptr()) } == -1 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: a successful `pipe` returns two newly owned descriptors.
        let read_fd = unsafe { OwnedFd::from_raw_fd(descriptors[0]) };
        // SAFETY: a successful `pipe` returns two newly owned descriptors.
        let write_fd = unsafe { OwnedFd::from_raw_fd(descriptors[1]) };
        set_close_on_exec(&read_fd)?;
        set_close_on_exec(&write_fd)?;

        // SAFETY: both descriptors are valid. The owned `write_fd` remains
        // alive until after `dup2` has duplicated it onto process stderr.
        if unsafe { libc::dup2(write_fd.as_raw_fd(), libc::STDERR_FILENO) } == -1 {
            return Err(io::Error::last_os_error());
        }
        drop(write_fd);

        // Prevent unrelated exec'd children from retaining the route forever.
        if let Err(error) = set_close_on_exec_raw(libc::STDERR_FILENO) {
            let _ = original.restore();
            return Err(error);
        }

        let (completed_tx, completed) = mpsc::channel();
        let reader = match std::thread::Builder::new()
            .name("vf-native-stderr".into())
            .spawn(move || {
                read_stderr(File::from(read_fd));
                let _ = completed_tx.send(());
            }) {
            Ok(reader) => reader,
            Err(error) => {
                let _ = original.restore();
                return Err(error);
            }
        };

        Ok(Self {
            original,
            reader: Some(reader),
            completed,
            restored: false,
        })
    }

    pub(super) fn emergency(&self) -> Emergency {
        let original = self.original.clone();
        Arc::new(move |message| original.write_emergency(message))
    }

    pub(super) fn close(&mut self, timeout: Duration) {
        self.restore();
        if self.completed.recv_timeout(timeout).is_ok() {
            if let Some(reader) = self.reader.take() {
                let _ = reader.join();
            }
        }
    }

    fn restore(&mut self) {
        if !self.restored {
            let _ = self.original.restore();
            self.restored = true;
        }
    }
}

impl Drop for StderrRoute {
    fn drop(&mut self) {
        self.restore();
        if self.completed.try_recv().is_ok() {
            if let Some(reader) = self.reader.take() {
                let _ = reader.join();
            }
        }
        // An unfinished reader is intentionally detached. Restoring stderr
        // closes the pipe's only process-owned writer, so it will observe EOF.
    }
}

fn set_close_on_exec(fd: &OwnedFd) -> io::Result<()> {
    set_close_on_exec_raw(fd.as_raw_fd())
}

fn set_close_on_exec_raw(fd: libc::c_int) -> io::Result<()> {
    // SAFETY: `fd` is a live descriptor owned by this process.
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
    if flags == -1 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: `fd` remains live and `flags | FD_CLOEXEC` is a valid flag set.
    if unsafe { libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) } == -1 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn read_stderr(mut input: File) {
    let mut chunk = [0_u8; READ_BYTES];
    let mut line = Vec::with_capacity(MAX_LINE_BYTES);
    let mut discarded = 0_u64;

    loop {
        match input.read(&mut chunk) {
            Ok(0) => {
                emit_line(&mut line, discarded);
                break;
            }
            Ok(read) => {
                for byte in &chunk[..read] {
                    if *byte == b'\n' {
                        emit_line(&mut line, discarded);
                        discarded = 0;
                    } else if line.len() < MAX_LINE_BYTES {
                        line.push(*byte);
                    } else {
                        discarded = discarded.saturating_add(1);
                    }
                }
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => {
                tracing::warn!(
                    event = "field_native.stderr.read_failed",
                    component = "stderr-router",
                    error = %error,
                    "The field-native stderr route failed"
                );
                break;
            }
        }
    }
}

fn emit_line(line: &mut Vec<u8>, discarded: u64) {
    if line.last() == Some(&b'\r') {
        line.pop();
    }
    if line.is_empty() && discarded == 0 {
        return;
    }
    let value = String::from_utf8_lossy(line);
    if let Some(value) = value.strip_prefix(SIDECAR_PREFIX) {
        tracing::warn!(
            event = "field_native.sidecar.stderr",
            component = "sidecar",
            raw = true,
            raw_line = %value,
            raw_truncated = discarded > 0,
            raw_discarded_bytes = discarded,
            "A native sidecar wrote to stderr"
        );
    } else {
        tracing::warn!(
            event = "field_native.process.stderr",
            component = "stderr-router",
            raw = true,
            raw_line = %value,
            raw_truncated = discarded > 0,
            raw_discarded_bytes = discarded,
            "A native dependency wrote to process stderr"
        );
    }
    line.clear();
}

fn truncate_utf8(value: &str, maximum: usize) -> &str {
    if value.len() <= maximum {
        return value;
    }
    let mut end = maximum;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}
