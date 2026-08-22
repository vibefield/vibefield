// THE OS-LEVEL KEY INJECTOR — TP-S0c / TP-D19.
//
// The native control compares Ghostty and VibeField on the SAME keystroke. That
// means the keystroke has to arrive the same way for both, and the only way that
// is true of a foreign application is a real CGEvent through the window server.
// Electron's `sendInputEvent` injects below that layer — useful, and a different
// measurement (the difference between the two IS the window-server hop, which
// the rig reports as its own number rather than absorbing).
//
// WHY A COMPILED HELPER AND NOT `osascript`. Two reasons, both about the clock.
// An `osascript … keystroke` costs tens of milliseconds to launch, which is an
// order of magnitude more than the interval being measured; and its timestamp
// would be taken in the shell, before that launch, so the injection instant
// would be unknown to within its own startup. This stamps the clock on the line
// ABOVE `CGEvent.post` — nothing but the post is inside the interval.
//
// THE CLOCK — and the trap this rig fell into first, recorded because the wrong
// answer is plausible and silent. macOS has TWO monotonic clocks:
//
//   mach_absolute_time()   == CLOCK_UPTIME_RAW    == DispatchTime.uptimeNanoseconds
//                             — time since boot, NOT counting sleep
//   mach_continuous_time() == CLOCK_MONOTONIC_RAW
//                             — time since boot, COUNTING sleep
//
// Node's `process.hrtime.bigint()` is the SECOND (libuv reads continuous time on
// Darwin). Measured on this host, seconds apart:
//
//   DispatchTime.uptimeNanoseconds   652_765_804_630_125
//   CLOCK_UPTIME_RAW                 652_765_804_650_208
//   CLOCK_MONOTONIC_RAW              710_422_039_371_375
//   node process.hrtime.bigint()     710_422_076_033_875
//
// — a 57,656-second gap, which is this laptop's accumulated sleep. An injector
// stamping `DispatchTime` and a fixture stamping `hrtime` would have produced
// keystroke latencies wrong by sixteen hours; worse, someone could "fix" that by
// subtracting the median offset and get numbers that look right and mean
// nothing. So this file reads CLOCK_MONOTONIC_RAW explicitly, and the analysis
// refuses any pairing whose interval is negative or absurd rather than trusting
// that the two sides agree.
//
// PERMISSION. Posting to `.cghidEventTap` needs Accessibility for the launching
// process. `AXIsProcessTrusted()` is checked and reported rather than assumed:
// a run that silently posted nothing would look exactly like a terminal that
// never echoed.

import ApplicationServices
import Foundation

/// The clock Node reads. Named rather than inlined so there is exactly one place
/// this decision lives.
@inline(__always) func monotonicNs() -> UInt64 {
    clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW)
}

// macOS ANSI virtual key codes for a–z. Real key codes rather than
// `keyboardSetUnicodeString`: a terminal is entitled to read the physical key,
// and a synthetic unicode payload on virtual key 0 is not the event a keyboard
// produces. 26 ids is the probe alphabet's width on this path.
let keyCodes: [Character: CGKeyCode] = [
    "a": 0, "b": 11, "c": 8, "d": 2, "e": 14, "f": 3, "g": 5, "h": 4, "i": 34,
    "j": 38, "k": 40, "l": 37, "m": 46, "n": 45, "o": 31, "p": 35, "q": 12,
    "r": 15, "s": 1, "t": 17, "u": 32, "v": 9, "w": 13, "x": 7, "y": 16, "z": 6,
]

func argValue(_ name: String, _ fallback: String) -> String {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: "--\(name)"), index + 1 < args.count else {
        return fallback
    }
    return args[index + 1]
}

let count = Int(argValue("count", "60")) ?? 60
let gapMs = Double(argValue("gap-ms", "40")) ?? 40
let outPath = argValue("out", "")
let alphabet = Array("abcdefghijklmnopqrstuvwxyz")

var lines: [String] = []
lines.append(
    "{\"kind\":\"injector-start\",\"trusted\":\(AXIsProcessTrusted()),"
        + "\"monotonicNs\":\(monotonicNs()),"
        + "\"wallMs\":\(Int(Date().timeIntervalSince1970 * 1000))}")

if !AXIsProcessTrusted() {
    // Not fatal: the run continues so the record shows exactly what was posted
    // and that nothing was received, rather than the rig guessing at a cause.
    FileHandle.standardError.write(
        Data(
            "inject-keys: this process is NOT trusted for Accessibility — CGEvent.post will be dropped\n"
                .utf8))
}

// One event source for the whole run: creating one per key would put an
// allocation inside every measured interval.
let source = CGEventSource(stateID: .hidSystemState)

for index in 0..<count {
    let character = alphabet[index % alphabet.count]
    guard let code = keyCodes[character] else { continue }
    let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)
    let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)

    // THE MEASURED INSTANT. Everything above is setup; the post is the event.
    let injectedNs = monotonicNs()
    down?.post(tap: .cghidEventTap)
    up?.post(tap: .cghidEventTap)

    lines.append(
        "{\"kind\":\"inject\",\"index\":\(index),\"probeId\":\"\(character)\","
            + "\"injectedNs\":\(injectedNs)}")

    // usleep rather than a RunLoop: this process does nothing else, and a run
    // loop would add scheduling variance to a gap whose only job is to keep two
    // probes out of one display interval.
    usleep(useconds_t(gapMs * 1000))
}

lines.append(
    "{\"kind\":\"injector-end\",\"posted\":\(count),"
        + "\"monotonicNs\":\(monotonicNs())}")

let payload = lines.joined(separator: "\n") + "\n"
if outPath.isEmpty {
    FileHandle.standardOutput.write(Data(payload.utf8))
} else {
    if !FileManager.default.fileExists(atPath: outPath) {
        FileManager.default.createFile(atPath: outPath, contents: nil)
    }
    if let handle = FileHandle(forWritingAtPath: outPath) {
        handle.seekToEndOfFile()
        handle.write(Data(payload.utf8))
        handle.closeFile()
    }
}
