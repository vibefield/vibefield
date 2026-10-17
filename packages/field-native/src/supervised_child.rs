//! FW-D4 — the floor's ONE supervised child, extracted from the cells' generation
//! (`services/terminal.rs` `run_cell_generation_inner`, its behavior unchanged) so the freeway
//! host is the second kind on the same shape, never a copy of the spawn pattern
//! (`draft/thinking-freeway.md` v0.3 §3; the addendum's Note 15):
//! - argv carries non-secrets only; the BOOTSTRAP line on stdin carries the secrets and the state
//!   (EL7: never argv, never env, never disk, never a log);
//! - the child's HELLO is its first stdout line, within its deadline;
//! - stderr becomes the floor's labeled diagnostics, line by line, for the child's life;
//! - later stdin lines are UPDATES, and stdin's EOF is the LEASH: the child drains itself out,
//!   and past the drain budget it is killed;
//! - stdout lines after the hello are the child's own to say (a cell's exit report, the host's
//!   joins and leaves);
//! - a descriptor the child inherits (the freeway host's floor-held listener) is placed at
//!   `INHERITED_FD` by `inherit`, the one place that knows `dup2`'s trap.

use serde::de::DeserializeOwned;
use std::ffi::OsString;
#[cfg(unix)]
use std::os::fd::RawFd;
use std::path::Path;
use std::process::{ExitStatus, Stdio};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

/// How long a child has to say its last line once it has exited.
const LAST_LINE: Duration = Duration::from_millis(500);

/// Where a child finds the descriptor it inherits (`field-freeway-host --listener-fd 3`).
#[cfg(unix)]
pub const INHERITED_FD: RawFd = 3;

/// A descriptor a child inherits: a Unix fd. The Windows socket-handle path is not built, and
/// a Windows start that names one says so.
#[cfg(unix)]
pub type Inherited = RawFd;
#[cfg(windows)]
pub type Inherited = std::os::windows::io::RawSocket;

/// Hand `fd` to the child at `INHERITED_FD`, open across the exec. `dup2` onto itself is a
/// no-op that LEAVES close-on-exec set: a descriptor the parent already holds at 3 (a test
/// process's first socket is just that) would be closed by the exec, and the child would adopt
/// whatever lands there next. That case clears the flag instead.
#[cfg(unix)]
pub fn inherit(command: &mut std::process::Command, fd: RawFd) {
    use std::os::unix::process::CommandExt;
    // SAFETY: only `fcntl` and `dup2`, both async-signal-safe, between fork and exec.
    unsafe {
        command.pre_exec(move || {
            let placed = if fd == INHERITED_FD {
                let flags = libc::fcntl(fd, libc::F_GETFD);
                if flags == -1 {
                    -1
                } else {
                    libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC)
                }
            } else {
                libc::dup2(fd, INHERITED_FD)
            };
            if placed == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

/// What a child's forwarded stderr lines are logged as.
#[derive(Debug, Clone, Copy)]
pub struct StderrLabel {
    pub event: &'static str,
    pub component: &'static str,
    /// The log line's message.
    pub what: &'static str,
    pub instance: u32,
}

/// One child to start.
pub struct ChildSpec<'a> {
    pub bin: &'a Path,
    /// Non-secrets only.
    pub args: Vec<OsString>,
    /// Written as ONE line: the secrets and the state.
    pub bootstrap: serde_json::Value,
    pub hello_deadline: Duration,
    pub stderr: StderrLabel,
    /// A descriptor the child finds at `INHERITED_FD`: the freeway host's floor-held listener.
    /// A cell inherits none.
    pub inherit: Option<Inherited>,
}

/// Why a child never said its hello. The caller says it in its own words.
#[derive(Debug)]
pub enum StartFailure {
    Spawn(std::io::Error),
    Bootstrap(std::io::Error),
    HelloUnparsed(serde_json::Error),
    ExitedBeforeHello,
    NoHello(Duration),
}

/// How a requested drain ended.
#[derive(Debug)]
pub struct Drained {
    /// The child outlived the budget and was killed; its drain is unknown.
    pub overran: bool,
    /// The child's last stdout line, said within half a second of its exit.
    pub last_line: Option<String>,
}

#[cfg(unix)]
fn hand_over(command: &mut Command, fd: Inherited) -> Result<(), StartFailure> {
    inherit(command.as_std_mut(), fd);
    Ok(())
}

#[cfg(windows)]
fn hand_over(_: &mut Command, _: Inherited) -> Result<(), StartFailure> {
    let unsupported = std::io::ErrorKind::Unsupported;
    let why =
        "an inherited descriptor rides a Unix fd; the Windows socket-handle path is not built";
    Err(StartFailure::Spawn(std::io::Error::new(unsupported, why)))
}

/// A child that said its hello.
pub struct SupervisedChild {
    child: Child,
    stdin: Option<ChildStdin>,
    lines: Lines<BufReader<ChildStdout>>,
    stderr: tokio::task::JoinHandle<()>,
}

impl Drop for SupervisedChild {
    fn drop(&mut self) {
        self.stderr.abort();
    }
}

impl SupervisedChild {
    /// Spawn, write the bootstrap line, and read the hello within its deadline. A child that does
    /// not hello is killed (or, having exited, reaped) before the failure returns.
    pub async fn start<H: DeserializeOwned>(
        spec: ChildSpec<'_>,
    ) -> Result<(Self, H), StartFailure> {
        let mut command = Command::new(spec.bin);
        command
            .args(&spec.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(descriptor) = spec.inherit {
            hand_over(&mut command, descriptor)?;
        }
        let mut child = command.spawn().map_err(StartFailure::Spawn)?;
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        // The child's diagnostics become the floor's, labeled — the parent owns log routing
        // (the child writes plain lines to its stderr).
        let label = spec.stderr;
        let stderr = tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::info!(
                    event = label.event,
                    component = label.component,
                    instance = label.instance,
                    line = %line,
                    "{}",
                    label.what
                );
            }
        });
        let mut supervised = Self {
            child,
            stdin: Some(stdin),
            lines: BufReader::new(stdout).lines(),
            stderr,
        };
        let bootstrap = format!("{}\n", spec.bootstrap);
        let written = match supervised.stdin.as_mut() {
            Some(stdin) => stdin.write_all(bootstrap.as_bytes()).await,
            None => Ok(()),
        };
        if let Err(error) = written {
            supervised.kill().await;
            return Err(StartFailure::Bootstrap(error));
        }
        match tokio::time::timeout(spec.hello_deadline, supervised.lines.next_line()).await {
            Ok(Ok(Some(line))) => match serde_json::from_str(&line) {
                Ok(hello) => Ok((supervised, hello)),
                Err(error) => {
                    supervised.kill().await;
                    Err(StartFailure::HelloUnparsed(error))
                }
            },
            Ok(Ok(None)) | Ok(Err(_)) => {
                let _ = supervised.child.wait().await;
                Err(StartFailure::ExitedBeforeHello)
            }
            Err(_) => {
                supervised.kill().await;
                Err(StartFailure::NoHello(spec.hello_deadline))
            }
        }
    }

    /// A later stdin line: an update (a cell born or gone, a key rotated, a revoke).
    pub async fn update(&mut self, line: &serde_json::Value) -> std::io::Result<()> {
        let stdin = self.stdin.as_mut().ok_or(std::io::ErrorKind::BrokenPipe)?;
        stdin.write_all(format!("{line}\n").as_bytes()).await
    }

    /// The child's next stdout line after its hello; `None` once it has closed stdout.
    pub async fn next_line(&mut self) -> Option<String> {
        self.lines.next_line().await.ok().flatten()
    }

    /// The child's own end, when no drain was asked (a crash). Its last line is `last_line`'s.
    pub async fn wait(&mut self) -> std::io::Result<ExitStatus> {
        self.child.wait().await
    }

    /// The child's last stdout line, if it says one within half a second.
    pub async fn last_line(&mut self) -> Option<String> {
        tokio::time::timeout(LAST_LINE, self.lines.next_line())
            .await
            .ok()?
            .ok()?
    }

    /// The leash: close stdin so the child drains itself out; past `budget`, kill it.
    pub async fn drain(mut self, budget: Duration) -> Drained {
        drop(self.stdin.take());
        if tokio::time::timeout(budget, self.child.wait())
            .await
            .is_err()
        {
            self.kill().await;
            return Drained {
                overran: true,
                last_line: None,
            };
        }
        Drained {
            overran: false,
            last_line: self.last_line().await,
        }
    }

    async fn kill(&mut self) {
        let _ = self.child.start_kill();
        let _ = self.child.wait().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    struct Hello {
        pid: u32,
    }

    fn sh(script: &str) -> ChildSpec<'static> {
        ChildSpec {
            bin: Path::new("/bin/sh"),
            args: vec!["-c".into(), script.into()],
            bootstrap: serde_json::json!({ "secret": "rides the pipe" }),
            hello_deadline: Duration::from_millis(2_000),
            stderr: StderrLabel {
                event: "test.child_stderr",
                component: "test",
                what: "child",
                instance: 0,
            },
            inherit: None,
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_descriptor_handed_over_is_the_childs_at_three_and_none_is_there_otherwise() {
        use std::os::fd::AsRawFd;
        #[derive(Deserialize)]
        struct Found {
            socket: bool,
        }
        let script = r#"read boot; if [ -S /dev/fd/3 ]; then echo '{"socket":true}'; else echo '{"socket":false}'; fi; cat >/dev/null"#;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let mut handed = sh(script);
        handed.inherit = Some(listener.as_raw_fd());
        let (child, found) = SupervisedChild::start::<Found>(handed).await.unwrap();
        assert!(found.socket, "the child finds the listener at descriptor 3");
        child.drain(Duration::from_secs(2)).await;
        let (child, found) = SupervisedChild::start::<Found>(sh(script)).await.unwrap();
        assert!(!found.socket, "nothing is handed over unasked");
        child.drain(Duration::from_secs(2)).await;
    }

    #[tokio::test]
    async fn the_bootstrap_rides_stdin_the_hello_is_stdout_and_the_leash_drains_it() {
        // Echo the bootstrap back on stderr, hello, read updates until EOF, then say a last line.
        let script = r#"read boot; echo "$boot" >&2; echo '{"pid": 7}'; while read update; do echo "got $update"; done; echo bye"#;
        let (mut child, hello) = SupervisedChild::start::<Hello>(sh(script)).await.unwrap();
        assert_eq!(hello.pid, 7);
        child
            .update(&serde_json::json!({ "revoke": {} }))
            .await
            .unwrap();
        assert_eq!(
            child.next_line().await.as_deref(),
            Some(r#"got {"revoke":{}}"#)
        );
        let drained = child.drain(Duration::from_secs(2)).await;
        assert!(!drained.overran);
        assert_eq!(drained.last_line.as_deref(), Some("bye"));
    }

    #[tokio::test]
    async fn a_child_that_will_not_hello_is_killed_and_a_silent_exit_is_said() {
        let mut slow = sh("read boot; sleep 30");
        slow.hello_deadline = Duration::from_millis(200);
        assert!(matches!(
            SupervisedChild::start::<Hello>(slow).await,
            Err(StartFailure::NoHello(_))
        ));
        assert!(matches!(
            SupervisedChild::start::<Hello>(sh("read boot; exit 3")).await,
            Err(StartFailure::ExitedBeforeHello)
        ));
        assert!(matches!(
            SupervisedChild::start::<Hello>(sh("read boot; echo not-json")).await,
            Err(StartFailure::HelloUnparsed(_))
        ));
        let missing = ChildSpec {
            bin: Path::new("/nonexistent/child"),
            ..sh("")
        };
        assert!(matches!(
            SupervisedChild::start::<Hello>(missing).await,
            Err(StartFailure::Spawn(_))
        ));
    }

    #[tokio::test]
    async fn a_child_that_outlives_its_drain_budget_is_killed() {
        // It ignores EOF on stdin: the leash cannot drain it, so the budget kills it.
        let script = r#"read boot; echo '{"pid": 9}'; trap '' TERM; while true; do sleep 1; done"#;
        let (child, _) = SupervisedChild::start::<Hello>(sh(script)).await.unwrap();
        let drained = child.drain(Duration::from_millis(300)).await;
        assert!(drained.overran);
    }
}
