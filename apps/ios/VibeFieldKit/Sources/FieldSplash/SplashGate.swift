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
///
/// WI-1 (DESIGN.md §8 "The phone's way in"): while the content holds it (`.splashHolds`), the splash
/// stays, and what the content puts on it (`.splashOverlay`) stands over its field; a hold that comes
/// after the splash has gone brings it back over the content, by its own fade, and what stands on it
/// comes once the splash stands whole again. Released, it leaves by its own exit once the content is
/// steady again. The content hears whether the splash stands whole over it (`splashCovers`), so what a
/// hold takes away (a sign-out's tabs) stays under the splash until it does.
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
          .environment(\.splashCovers, model.covers)
      }
      if !model.gone {
        splash
          .opacity(model.revealing ? 0 : 1)
          .allowsHitTesting(!model.revealing)
          // under the way in the field is its ground, not a word of its own
          .accessibilityHidden(model.holding)
          // a splash that comes back over the content fades in (WI-1)
          .transition(.opacity)
      }
    }
    // what the content puts on the field, drawn over it only while it holds the splash up and the splash
    // stands whole: a come-back fades in over the content first, then the way in (DESIGN.md §8)
    .overlayPreferenceValue(SplashOverlayKey.self) { overlay in
      if let overlay, model.holding, model.covers {
        overlay.view
          .transition(.opacity)
      }
    }
    .onPreferenceChange(SplashHoldKey.self) { [model] hold in
      Task { @MainActor in model.setHold(hold) }
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

/// The splash's time, given to its model (WI-1's review): when a call falls due, and when the content
/// draws on time. The app's are the continuous clock and the display link (`SplashTaskTimer`,
/// `FrameWatch`); a test steps its own, so no row waits on the wall clock (item 157's lesson).
@MainActor
protocol SplashTimer: AnyObject {
  /// Runs `body` once `delay` has passed, unless the handle is cancelled first.
  @discardableResult
  func after(_ delay: Duration, _ body: @escaping @MainActor () -> Void) -> any SplashDue
}

/// A call a `SplashTimer` has scheduled: cancelled, it never runs.
@MainActor
protocol SplashDue: AnyObject {
  func cancel()
}

/// Whether the content draws on time: `onSteady`, once, when it does; `stop` stops the watch.
@MainActor
protocol SplashSteadiness: AnyObject {
  func start(_ onSteady: @escaping @MainActor () -> Void)
  func stop()
}

/// The app's timer: a task asleep on the continuous clock.
@MainActor
final class SplashTaskTimer: SplashTimer {
  @discardableResult
  func after(_ delay: Duration, _ body: @escaping @MainActor () -> Void) -> any SplashDue {
    SplashTask(
      Task { @MainActor in
        try? await Task.sleep(for: delay)
        guard !Task.isCancelled else { return }
        body()
      })
  }
}

@MainActor
private final class SplashTask: SplashDue {
  private let task: Task<Void, Never>

  init(_ task: Task<Void, Never>) {
    self.task = task
  }

  func cancel() {
    task.cancel()
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
  /// WI-1 — the content asks the splash to stand (`.splashHolds`): it never leaves while this holds.
  private(set) var holding = false
  /// WI-1 (the review's M1) — whether the splash stands whole over the content: from launch until it
  /// starts to leave, and again once a come-back's fade has run. The content hears it
  /// (`splashCovers`): a sign-out's tabs stay under the splash fading in over them, and go once it
  /// is whole.
  private(set) var covers = true

  @ObservationIgnored private var begun = false
  @ObservationIgnored private var fieldShown = false
  @ObservationIgnored private var reduceMotion = false
  @ObservationIgnored private var stable = false
  /// Whether the field has yet to stand its floor, counted from its first frame (never, if it does not
  /// show), and the call that ends it.
  @ObservationIgnored private var floorPending = false
  @ObservationIgnored private var floorDue: (any SplashDue)?
  /// Counts the splash's moves (it leaves, it comes back), so a fade's end that a later move overtook
  /// does nothing.
  @ObservationIgnored private var moves = 0
  /// What the splash never waits past for content that never steadies: the mount's limit, then each
  /// release's. One stands at a time, and a hold ends it (WI-1's review, L2): an earlier limit is not the
  /// next release's.
  @ObservationIgnored private var stableDue: (any SplashDue)?
  private let timer: any SplashTimer
  private let watch: any SplashSteadiness
  #if DEBUG
    @ObservationIgnored private var held = false
    private let begunAt = CACurrentMediaTime()
  #endif

  init(timer: any SplashTimer = SplashTaskTimer(), watch: any SplashSteadiness = FrameWatch()) {
    self.timer = timer
    self.watch = watch
  }

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
        covers = false
        return
      }
    #endif
    timer.after(SplashTiming.startLimit) { [weak self] in self?.mountContent() }
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
    floorPending = true
    floorDue = timer.after(.seconds(delay + fade) + SplashTiming.floor) { [weak self] in
      self?.floorPending = false
      self?.revealIfReady()
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
    stableDue = timer.after(SplashTiming.stableLimit) { [weak self] in
      self?.stable = true
      self?.revealIfReady()
    }
  }

  /// WI-1 — the content's hold. Taken, the splash stays, and comes back over the content if it had
  /// gone or was leaving; released, the content is watched until it is steady again, then the splash
  /// leaves by its own exit (the floor still counts from the field's first frame).
  func setHold(_ hold: Bool) {
    guard hold != holding else { return }
    holding = hold
    if hold {
      // the watch and the limit a release (or the mount) started end with it: the next release starts its own
      watch.stop()
      stableDue?.cancel()
      if revealing || gone { comeBack() }
      return
    }
    note("the hold is released")
    guard contentMounted else { return }
    stable = false
    watch.start { [weak self] in
      self?.note("the content is frame-stable")
      self?.stable = true
      self?.revealIfReady()
    }
    stableDue?.cancel()
    stableDue = timer.after(SplashTiming.stableLimit) { [weak self] in
      self?.stable = true
      self?.revealIfReady()
    }
  }

  /// The splash over the content again (a sign-out, Tailscale asking a remembered phone again): a new
  /// surface stands on the launch picture, fades in over the content, and the field comes up around its
  /// mark as at launch. The content stays mounted under it, and hears that the splash covers it once
  /// the fade has run.
  private func comeBack() {
    note("the splash comes back")
    watch.stop()
    // A splash that had gone comes back as a new surface, whose first frame stands a new floor. One caught
    // mid-fade is the same surface, its field up and its floor stood (WI-1's review, L1).
    if gone {
      fieldShown = false
      floorPending = false
      floorDue?.cancel()
    }
    // the content is watched again once the hold is released; until then the new field stands its floor
    stable = false
    covers = false
    moves += 1
    let move = moves
    let fade = reduceMotion ? SplashTiming.fadeOut / 2 : SplashTiming.fadeOut
    withAnimation(FieldMotion.plainEase(fade)) {
      gone = false
      revealing = false
    }
    timer.after(.seconds(fade)) { [weak self] in
      guard let self, self.moves == move, !self.revealing, !self.gone else { return }
      self.covers = true
      self.note("the splash covers the content")
    }
  }

  private func revealIfReady() {
    guard contentMounted, stable, !revealing, !holding, !floorPending else { return }
    watch.stop()
    note("the splash leaves")
    covers = false
    moves += 1
    let fade = reduceMotion ? SplashTiming.fadeOut / 2 : SplashTiming.fadeOut
    withAnimation(FieldMotion.plainEase(fade)) { revealing = true }
    if reduceMotion {
      settled = true
    } else {
      withAnimation(FieldMotion.island(SplashTiming.settle)) { settled = true }
    }
    let move = moves
    timer.after(.seconds(fade)) { [weak self] in
      // a later move overtook this fade (a hold brought it back, and maybe it is leaving again): its end is not
      // this fade's (WI-1's review, L1)
      guard let self, self.moves == move, self.revealing else { return }
      self.gone = true
      self.note("the splash is gone")
    }
  }
}

/// Whether the main thread is drawing on time: steady once `SplashTiming.steadyFrames` frames in a
/// row have come within half a frame of when they were due (the desk's frame-stability gate —
/// never reveal mid-hitch).
@MainActor
final class FrameWatch: NSObject, SplashSteadiness {
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
