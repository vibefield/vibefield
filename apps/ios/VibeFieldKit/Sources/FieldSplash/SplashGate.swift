import FieldDesign
import QuartzCore
import SwiftUI
import UIKit

/// The splash's clock (DESIGN.md §8 "The phone's splash"; §6's plain `ease` and island curve).
public enum SplashTiming {
  /// The launch screen fades from over the field once its first frame is up (halved under Reduce
  /// Motion): the surface's render thread runs it, as a Core Animation fade on plain `ease`.
  public static let fadeIn = 0.24
  /// Once in, it stands at least this long: FG-L6's floor for a repeat visit — a floor, never a stage.
  public static let floor: Duration = .milliseconds(700)
  /// Then it leaves as the desk's reveal does: a plain `ease` fade (halved under Reduce Motion)…
  public static let fadeOut = 0.24
  /// …while the home settles from 0.99 on the island curve (fades only under Reduce Motion).
  public static let settleFrom = 0.99
  public static let settle = 0.56
  /// The home is frame-stable after this many frames on time in a row (100ms at 60 a second).
  public static let steadyFrames = 6
  /// What the splash never waits past: its own first frame (the home comes under the launch
  /// screen's picture anyway), and a home that never steadies (shown anyway).
  public static let startLimit: Duration = .seconds(2)
  public static let stableLimit: Duration = .seconds(4)
}

extension SplashLook {
  /// The splash for an appearance: Wormhole · Obsidian by night, Obsidian Light by day.
  public static func `for`(_ scheme: ColorScheme) -> SplashLook { scheme == .dark ? .dark : .light }
}

/// The app's first face (DESIGN.md §8 "The phone's splash"): the field — the iPhone look of
/// vibefield-splash, Wormhole · Obsidian by night and Obsidian Light by day, as the window wears
/// the phone's Appearance — and its living mark at the centre, over everything at launch. Just the
/// field and the mark: no bar, no stage line.
///
/// `content` is mounted behind it once the field shows, so the home's own start (the swarm's shader
/// compile among it) happens under the splash, never in front of it; the splash draws on a thread of
/// its own, so that work never stops it. It leaves once the content is frame-stable and the field
/// has stood its floor.
public struct SplashGate<Content: View>: View {
  private let content: () -> Content
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var scenePhase
  @State private var model = SplashGateModel()

  public init(@ViewBuilder content: @escaping () -> Content) {
    self.content = content
  }

  public var body: some View {
    ZStack {
      if model.contentMounted {
        content()
          .scaleEffect(model.settled || reduceMotion ? 1 : SplashTiming.settleFrom)
          .accessibilityHidden(!model.revealing)
      }
      if !model.gone {
        splash
          .opacity(model.revealing ? 0 : 1)
          .allowsHitTesting(!model.revealing)
      }
    }
    .onAppear { model.begin(reduceMotion: reduceMotion) }
  }

  private var splash: some View {
    let model = model
    return SplashCanvas(
      look: SplashLook.for(colorScheme), motion: !reduceMotion, active: scenePhase != .background,
      fadeIn: reduceMotion ? SplashTiming.fadeIn / 2 : SplashTiming.fadeIn,
      onFirstFrame: { model.fieldPresented(at: $0) },
      onFailure: { model.fieldFailed($0) }
    )
    .ignoresSafeArea()
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Starting VibeField")
  }
}

/// The splash's decisions, in order: the field shows → the content comes under it → the content
/// steadies and the floor passes → the splash leaves → it is gone (its thread and memory with it).
@MainActor
@Observable
final class SplashGateModel {
  private(set) var contentMounted = false
  private(set) var revealing = false
  private(set) var settled = false
  private(set) var gone = false

  @ObservationIgnored private var begun = false
  @ObservationIgnored private var fieldShown = false
  @ObservationIgnored private var reduceMotion = false
  @ObservationIgnored private var stable = false
  /// When the field will have stood its floor (none while it has not shown, or if it never does).
  @ObservationIgnored private var floorUntil: ContinuousClock.Instant?
  private let watch = FrameWatch()
  #if DEBUG
    @ObservationIgnored private var held = false
    private let begunAt = CACurrentMediaTime()
  #endif

  #if DEBUG
    /// How long this process has run, from the kernel's own start time (the launch screen's share
    /// of a launch is the time before the gate stood).
    private static func sinceLaunch() -> Int? {
      var info = kinfo_proc()
      var size = MemoryLayout<kinfo_proc>.stride
      var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
      guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return nil }
      let start = info.kp_proc.p_un.__p_starttime
      let started = Double(start.tv_sec) + Double(start.tv_usec) / 1e6
      return Int(((Date().timeIntervalSince1970 - started) * 1000).rounded())
    }
  #endif

  /// The launch's beats, timed from the gate's first appearance (the Debug build's console only,
  /// as `[attach] …` is the attach's: what a device run's capture carries).
  private func note(_ what: @autoclosure () -> String) {
    #if DEBUG
      print("[splash] \(what()) at \(Int(((CACurrentMediaTime() - begunAt) * 1000).rounded())) ms")
    #endif
  }

  func begin(reduceMotion: Bool) {
    guard !begun else { return }
    begun = true
    self.reduceMotion = reduceMotion
    #if DEBUG
      note("the gate stood \(Self.sinceLaunch().map { "\($0) ms after the process started" } ?? "")")
      // Debug launch arguments (README): `-vf-splash-hold` holds the splash with nothing behind it,
      // for its photograph. A run with a `-vf-` argument that stamps a state asked for that state,
      // so it gets it at once; the whole mock phone (`-vf-mock` alone, the VibeField-Mock scheme)
      // starts as the app does, and `-vf-splash` puts the splash in front of any run.
      let arguments = ProcessInfo.processInfo.arguments
      if arguments.contains("-vf-splash-hold") {
        held = true
        return
      }
      let stamped = arguments.contains { $0.hasPrefix("-vf-") && $0 != "-vf-mock" && !$0.hasPrefix("-vf-splash") }
      if stamped && !arguments.contains("-vf-splash") {
        contentMounted = true
        settled = true
        revealing = true
        gone = true
        return
      }
    #endif
    Task {
      try? await Task.sleep(for: SplashTiming.startLimit)
      mountContent()
    }
  }

  /// The field's first frame is done, shown at `at` (CACurrentMediaTime's clock), and the surface's
  /// own thread has begun the launch screen's fade on it.
  func fieldPresented(at: CFTimeInterval) {
    guard !fieldShown, !revealing else { return }
    let fade = reduceMotion ? SplashTiming.fadeIn / 2 : SplashTiming.fadeIn
    let delay = max(0, at - CACurrentMediaTime())
    fieldShown = true
    note("the field's first frame is up")
    // a field that came after the content had steadied holds nothing up
    if contentMounted && stable {
      revealIfReady()
      return
    }
    let until = ContinuousClock.now + .seconds(delay + fade) + SplashTiming.floor
    floorUntil = until
    Task {
      try? await Task.sleep(until: until)
      revealIfReady()
    }
    // the content now: the fade is the render server's, so its start can hold the main thread
    mountContent()
  }

  func fieldFailed(_ why: String) {
    // the launch screen's picture stands, honest and still, until the content has steadied
    note("the field could not start (\(why))")
    mountContent()
  }

  private func mountContent() {
    #if DEBUG
      if held { return }
    #endif
    guard !contentMounted else { return }
    contentMounted = true
    note("the home is mounted under it")
    watch.start { [weak self] in
      self?.note("the home is frame-stable")
      self?.stable = true
      self?.revealIfReady()
    }
    Task {
      try? await Task.sleep(for: SplashTiming.stableLimit)
      stable = true
      revealIfReady()
    }
  }

  private func revealIfReady() {
    guard contentMounted, stable, !revealing else { return }
    if let floorUntil, ContinuousClock.now < floorUntil { return }
    watch.stop()
    note("the splash leaves")
    let fade = reduceMotion ? SplashTiming.fadeOut / 2 : SplashTiming.fadeOut
    withAnimation(FieldMotion.plainEase(fade)) { revealing = true }
    if reduceMotion {
      settled = true
    } else {
      withAnimation(FieldMotion.island(SplashTiming.settle)) { settled = true }
    }
    Task {
      try? await Task.sleep(for: .seconds(fade))
      gone = true
      note("the splash is gone")
    }
  }
}

/// Whether the main thread is drawing on time: steady once `SplashTiming.steadyFrames` frames in a
/// row have come within half a frame of when they were due (the desk's frame-stability gate —
/// never reveal mid-hitch).
@MainActor
final class FrameWatch: NSObject {
  private var link: CADisplayLink?
  private var last: CFTimeInterval = 0
  private var steady = 0
  private var onSteady: (@MainActor () -> Void)?

  func start(_ onSteady: @escaping @MainActor () -> Void) {
    stop()
    self.onSteady = onSteady
    last = 0
    steady = 0
    let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
    link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  func stop() {
    link?.invalidate()
    link = nil
  }

  @objc private func tick(_ link: CADisplayLink) {
    defer { last = link.timestamp }
    guard last > 0 else { return }
    let frame = max(link.targetTimestamp - link.timestamp, 1.0 / 120)
    steady = link.timestamp - last <= frame * 1.5 ? steady + 1 : 0
    guard steady >= SplashTiming.steadyFrames else { return }
    stop()
    onSteady?()
  }
}

/// The surface, mounted in SwiftUI; leaving the tree stops its thread.
struct SplashCanvas: UIViewRepresentable {
  let look: SplashLook
  let motion: Bool
  let active: Bool
  let fadeIn: Double
  let onFirstFrame: @MainActor @Sendable (CFTimeInterval) -> Void
  let onFailure: @MainActor @Sendable (String) -> Void

  func makeUIView(context: Context) -> SplashSurfaceView {
    SplashSurfaceView(
      look: look, motion: motion, active: active, fadeIn: fadeIn, onFirstFrame: onFirstFrame, onFailure: onFailure)
  }

  func updateUIView(_ view: SplashSurfaceView, context: Context) {
    view.update(look: look, motion: motion, active: active)
  }

  static func dismantleUIView(_ view: SplashSurfaceView, coordinator: ()) {
    view.stop()
  }
}
