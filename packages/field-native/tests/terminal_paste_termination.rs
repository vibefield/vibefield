//! The EL8 to ghosttea 0.13.0 (2026-10-22): a session whose program never reads a large paste still concludes when it
//! is terminated, and nothing keeps it alive after. This is the BOUND beside terminal_unit's class row
//! (`a_terminated_session_still_answers_a_program_that_asks_for_the_cursor`): the paste goes in through fieldd's own
//! automation door, the program never reads it, so the PTY fills and the write blocks. Termination must still reach
//! the program, the session must conclude inside the ladder's bound, and its last strong holder must be the test's
//! own handle once it has.
//!
//! ghosttea af7e38c (in 0.13.0, the input actor) lets the session go before a write that may not return. Before it, a
//! blocked paste held the session while the write stood. On unix the ladder's kill closes the PTY under the write, so
//! this row concludes on both pins: it is the bound, not the class (VF-PM). The class is the reply row.
//!
//! A REAL ghosttea session spawned by the harness, as `tp_activation.rs` does (`/bin/sh`, unix only). The paste is
//! LINES, not one long line: XNU drops canonical input past the line limit rather than block the writer, so a paste
//! with no line end never fills a macOS PTY (ghosttea's own row learned it, 2026-10-21).
#![cfg(unix)]

use ghosttea::session::{Persistence, SpawnOptions};
use ghosttea::{
    AutomationInputOperation, FrameHub, Session, SessionEnvironment, SessionProgramKind,
    TerminationSource, TextEngine,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[test]
fn a_terminated_session_concludes_while_its_program_never_reads_a_large_paste() {
    let session = Session::spawn(
        SpawnOptions {
            executable: "/bin/sh".into(),
            args: vec!["-c".into(), "stty -echo; exec sleep 30".into()],
            cwd: None,
            env: HashMap::new(),
            environment: Some(SessionEnvironment::Clean {
                variables: HashMap::from([("PATH".into(), "/usr/bin:/bin".into())]),
            }),
            cols: 80,
            rows: 24,
            persistence: Persistence::KeepUntilExit,
            program_kind: SessionProgramKind::Application,
            owner_id: None,
            scrollback_bytes: None,
        },
        FrameHub::new(16),
        Arc::new(Mutex::new(
            TextEngine::discover().expect("a monospace font"),
        )),
        Arc::new(|_, _| {}),
    )
    .expect("spawn the session");

    // 1 MiB of lines the program never reads: far past what a PTY's input queue holds, so the write blocks.
    let paste = format!("{}\n", "x".repeat(1023)).repeat(1024);
    session
        .automation_input(
            session.automation_state(),
            AutomationInputOperation::Paste {
                text: paste,
                submit: false,
            },
        )
        .expect("the paste is accepted");
    // Let the write reach the full PTY; the termination below must not depend on how far it got.
    thread::sleep(Duration::from_millis(300));

    let started = Instant::now();
    session
        .terminate(TerminationSource::User)
        .expect("terminate");
    // The ladder is 2 s + 2 s + 1 s; the bound leaves a loaded host its margin.
    let bound = Duration::from_secs(10);
    while !session.has_exited() && started.elapsed() < bound {
        thread::sleep(Duration::from_millis(10));
    }
    assert!(
        session.has_exited(),
        "a session whose program never reads its paste must still conclude when terminated (waited {bound:?})"
    );
    // Concluded means let go: once the frame thread has seen the PTY's end, the test's handle is the last one.
    while Arc::strong_count(&session) > 1 && started.elapsed() < bound {
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(
        Arc::strong_count(&session),
        1,
        "nothing may keep a concluded session alive ({:?} after the terminate)",
        started.elapsed()
    );
}
