use super::{lock_recover, Emergency};
use std::fs::File;
use std::io::{self, Read, Write};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

#[cfg(windows)]
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
#[cfg(windows)]
use windows_sys::Win32::Foundation::{
    DuplicateHandle, DUPLICATE_SAME_ACCESS, FALSE, HANDLE, INVALID_HANDLE_VALUE,
};
#[cfg(windows)]
use windows_sys::Win32::System::Console::{GetStdHandle, SetStdHandle, STD_ERROR_HANDLE};
#[cfg(windows)]
use windows_sys::Win32::System::Pipes::CreatePipe;
#[cfg(windows)]
use windows_sys::Win32::System::Threading::GetCurrentProcess;

const MAX_LINE_BYTES: usize = 16 * 1024;
const READ_BYTES: usize = 4 * 1024;
const MAX_EMERGENCY_BYTES: usize = 1_024;
const SIDECAR_PREFIX: &str = "[sidecar-stderr] ";

/// The retained pre-route stderr: the one sink an emergency may use, and the
/// thing shutdown puts back. Both platforms hold the same two obligations but
/// with different primitives, so the type is written twice instead of cfg'd
/// field by field — `segment.rs` is the house template for the split.
#[cfg(unix)]
struct OriginalStderr {
    file: Mutex<File>,
}

#[cfg(unix)]
impl OriginalStderr {
    fn write_emergency(&self, message: &str) {
        write_emergency_line(&mut *lock_recover(&self.file), message);
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

#[cfg(windows)]
struct OriginalStderr {
    /// A private duplicate, used only for emergencies. Owning a duplicate is
    /// this platform's `F_DUPFD_CLOEXEC`: dropping the route must never close a
    /// handle the process itself still holds. `None` when the process started
    /// with no stderr at all (a GUI/detached start reports NULL) — capture
    /// still installs; an emergency then has nowhere to land and is dropped.
    file: Mutex<Option<File>>,
    /// The `STD_ERROR_HANDLE` value the route displaced. `SetStdHandle` does
    /// not close what it displaces, so the pre-route object stays alive without
    /// a second duplicate. Held as `usize` because a raw `HANDLE` is neither
    /// `Send` nor `Sync` and the emergency sink crosses threads.
    displaced: usize,
    /// Our end of the capture pipe. Closing it is what hands the reader EOF;
    /// the unix twin gets that for free when `dup2` drops fd 2's reference.
    write_end: Mutex<Option<OwnedHandle>>,
}

#[cfg(windows)]
impl OriginalStderr {
    fn write_emergency(&self, message: &str) {
        if let Some(file) = lock_recover(&self.file).as_mut() {
            write_emergency_line(file, message);
        }
    }

    fn restore(&self) -> io::Result<()> {
        // SAFETY: `displaced` is the value this route swapped out at install and
        // is still live, because `SetStdHandle` never closes what it displaces.
        // NULL is a legitimate value to put back: it is what the process had.
        if unsafe { SetStdHandle(STD_ERROR_HANDLE, self.displaced as HANDLE) } == FALSE {
            // Leave the pipe writer alive — process stderr still points at it,
            // and a closed handle in the table is worse than an uncaptured one.
            return Err(io::Error::last_os_error());
        }
        // Dropping our writer after the swap is what ends the reader's read.
        // Windows has no `dup2`, so the swap and the close cannot be one step:
        // a stderr write racing shutdown can still hold the pipe handle it read
        // out of the table a moment earlier. Swapping first keeps the window to
        // exactly those writes.
        lock_recover(&self.write_end).take();
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

#[cfg(unix)]
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

        Self::spawn_reader(original, File::from(read_fd))
    }
}

#[cfg(windows)]
impl StderrRoute {
    /// `CreatePipe` + `SetStdHandle` is the windows twin of `pipe` + `dup2`, and
    /// it captures every Rust-level write to process stderr — including the
    /// `eprintln!` this route exists for. It does not capture a C dependency
    /// writing through the CRT's own `stderr`: this moves the Win32 std handle,
    /// where the unix twin moves fd 2, the one thing both layers share.
    pub(super) fn install() -> io::Result<Self> {
        // SAFETY: the call takes a constant selector and returns a handle owned
        // by the process std-handle table rather than by this call.
        let displaced = unsafe { GetStdHandle(STD_ERROR_HANDLE) };
        if displaced == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        let original = if displaced.is_null() {
            None
        } else {
            Some(duplicate_for_emergency(displaced)?)
        };

        let mut read: HANDLE = std::ptr::null_mut();
        let mut write: HANDLE = std::ptr::null_mut();
        // SAFETY: both out-params point at live storage. A null attribute
        // pointer is documented as "the handles cannot be inherited", which is
        // the `FD_CLOEXEC` the unix twin sets on both ends of its pipe.
        if unsafe { CreatePipe(&mut read, &mut write, std::ptr::null(), 0) } == FALSE {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: a successful `CreatePipe` returns two newly owned handles.
        let read_end = unsafe { OwnedHandle::from_raw_handle(read) };
        // SAFETY: a successful `CreatePipe` returns two newly owned handles.
        let write_end = unsafe { OwnedHandle::from_raw_handle(write) };

        // SAFETY: the handle is live, and `OriginalStderr` below keeps owning it
        // so the value parked in the std-handle table outlives the table entry.
        if unsafe { SetStdHandle(STD_ERROR_HANDLE, write_end.as_raw_handle()) } == FALSE {
            return Err(io::Error::last_os_error());
        }

        // Unlike `FD_CLOEXEC`, a non-inheritable handle does not keep children
        // out of the route: a `Command` that inherits stderr is handed an
        // inheritable duplicate by std. That is the safer divergence — children
        // keep a working stderr instead of a closed one — but a child outliving
        // `close` holds the pipe open, and the reader is then detached as usual.
        Self::spawn_reader(
            Arc::new(OriginalStderr {
                file: Mutex::new(original),
                displaced: displaced as usize,
                write_end: Mutex::new(Some(write_end)),
            }),
            File::from(read_end),
        )
    }
}

impl StderrRoute {
    fn spawn_reader(original: Arc<OriginalStderr>, input: File) -> io::Result<Self> {
        let (completed_tx, completed) = mpsc::channel();
        let reader = match std::thread::Builder::new()
            .name("vf-native-stderr".into())
            .spawn(move || {
                read_stderr(input);
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

#[cfg(unix)]
fn set_close_on_exec(fd: &OwnedFd) -> io::Result<()> {
    set_close_on_exec_raw(fd.as_raw_fd())
}

#[cfg(unix)]
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

/// The emergency sink writes through a private duplicate of the pre-route
/// stderr, so the route's own drop can never close the process's real one.
#[cfg(windows)]
fn duplicate_for_emergency(displaced: HANDLE) -> io::Result<File> {
    let mut duplicate: HANDLE = std::ptr::null_mut();
    // SAFETY: the source handle is live, source and target process are this
    // process, and the out-param points at live storage. `FALSE` keeps the
    // duplicate out of children, matching the unix `F_DUPFD_CLOEXEC`.
    let duplicated = unsafe {
        DuplicateHandle(
            GetCurrentProcess(),
            displaced,
            GetCurrentProcess(),
            &mut duplicate,
            0,
            FALSE,
            DUPLICATE_SAME_ACCESS,
        )
    };
    if duplicated == FALSE {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: a successful `DuplicateHandle` returns a newly owned handle.
    Ok(File::from(unsafe {
        OwnedHandle::from_raw_handle(duplicate)
    }))
}

/// One sanitized line on the pre-route stderr: an emergency is what the logging
/// stack says when the structured stream is the thing that failed, so it must
/// not become a paragraph on a descriptor someone else is also writing.
fn write_emergency_line(sink: &mut impl Write, message: &str) {
    let clean = message.replace(['\r', '\n'], " ");
    let clean = truncate_utf8(&clean, MAX_EMERGENCY_BYTES);
    let _ = sink.write_all(clean.as_bytes());
    let _ = sink.write_all(b"\n");
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
