import FieldRoutedTerminal
import Foundation

#if DEBUG
  /// fix8 — a DEBUG-only witness for a main thread that stops answering.
  ///
  /// PJ-7's second phone run left two readings of the stalled card: the mesh
  /// never made a leg's socket, or the main thread stopped right after the
  /// mint — the `···` tap and the swipe drew nothing, and the card's header
  /// still said `idle` sixteen seconds after its run had exited. Every attach
  /// deadline is a main-actor task, so under the second reading none of them
  /// fires and the attach log simply stops. This is what says so: a timer on a
  /// queue of its own pings the main queue, and when a ping has gone
  /// unanswered past the threshold it writes, through the attach log's own
  /// path, `main thread stalled 2.1 s, last attach phase: …` — again every ten
  /// seconds the stall lasts — and `main thread answered again after N s` when
  /// it ends. Release builds carry none of it.
  public final class MainThreadWitness: @unchecked Sendable {
    /// The app's: the main queue, 2 s, a ping every half second.
    public static let shared = MainThreadWitness()

    private let target: DispatchQueue
    private let threshold: Double
    private let interval: Double
    private let log: TerminalAttachLog
    private let lastPhase: @Sendable () -> String?
    private let queue = DispatchQueue(label: "com.jamesyong.vibefield.main-witness")
    // Everything below is touched on `queue` only.
    private var timer: DispatchSourceTimer?
    private var pingSent: DispatchTime?
    private var reported: Double = 0

    public init(
      target: DispatchQueue = .main, threshold: Double = 2, interval: Double = 0.5,
      log: TerminalAttachLog = .device,
      lastPhase: @escaping @Sendable () -> String? = { TerminalAttachLog.lastLine }
    ) {
      self.target = target
      self.threshold = threshold
      self.interval = interval
      self.log = log
      self.lastPhase = lastPhase
    }

    /// Start watching; a second start is nothing.
    public func start() {
      queue.async { [self] in
        guard timer == nil else { return }
        let source = DispatchSource.makeTimerSource(queue: queue)
        source.schedule(deadline: .now() + interval, repeating: interval)
        source.setEventHandler { [weak self] in self?.tick() }
        timer = source
        source.resume()
      }
    }

    public func stop() {
      queue.sync {
        timer?.cancel()
        timer = nil
        pingSent = nil
        reported = 0
      }
    }

    private func tick() {
      let now = DispatchTime.now()
      guard let sent = pingSent else {
        pingSent = now
        target.async { [weak self] in
          guard let self else { return }
          self.queue.async { self.answered(sent: now) }
        }
        return
      }
      let waited = Self.seconds(from: sent, to: now)
      guard waited > threshold, reported == 0 || waited - reported >= 10 else { return }
      reported = waited
      log.error(
        "main thread stalled \(Self.words(waited)) s, last attach phase: \(lastPhase() ?? "none")")
    }

    private func answered(sent: DispatchTime) {
      guard pingSent == sent else { return }
      pingSent = nil
      guard reported > 0 else { return }
      reported = 0
      log("main thread answered again after \(Self.words(Self.seconds(from: sent, to: .now()))) s")
    }

    private static func seconds(from start: DispatchTime, to end: DispatchTime) -> Double {
      Double(end.uptimeNanoseconds &- start.uptimeNanoseconds) / 1e9
    }

    private static func words(_ seconds: Double) -> String {
      String(format: "%.1f", seconds)
    }
  }
#endif
