import AVFoundation
import Foundation
import Observation
import Speech

/// Dictation, and where it lands.
///
/// The design's mic sits in the composer row immediately left of Send, and what
/// it produces is TEXT IN THE DRAFT — never bytes on the wire. That is the
/// whole reason this slice waited for its own: speech that went straight to the
/// terminal would be a keyboard nobody is holding, and a misheard word would
/// already be a command by the time it was read. In the draft it is a sentence
/// the user can still see, edit, and delete before Send commits it.
///
/// Privacy is the other half of the shape. Recognition is asked to stay on this
/// device wherever the device can do it (`requiresOnDeviceRecognition`), the
/// audio is streamed to the recognizer buffer by buffer and written nowhere,
/// and nothing here logs a transcript: a dictated command is exactly as
/// sensitive as a typed one, and EL7's rule about what agents may read applies
/// to what the phone keeps as much as to what the daemon does.
///
/// Every capability is checked out loud rather than assumed. `SFSpeechRecognizer`
/// is a failable initializer (a locale with no recognizer gives nil), an
/// existing recognizer can report itself unavailable, and a simulator has no
/// microphone at all — each of those becomes a state with a line to say, which
/// is D-i6: absences are honest, and there are no disabled controls on this
/// card.
@MainActor
@Observable
public final class DictationSession {

  /// What the mic is doing — and, when it cannot do anything, why.
  ///
  /// The two failure cases carry their own line rather than a code, because
  /// the card's job with either is to say one sentence and then forget it. A
  /// greyed-out key would say the same nothing in both.
  public enum State: Equatable, Sendable {
    case idle
    case listening
    /// Asked for and refused. The line names the switch that would undo it.
    case denied(String)
    /// Nothing was refused — there is nothing here to refuse with: no
    /// recognizer for the locale, none available right now, or no microphone.
    case unavailable(String)

    public var isListening: Bool { self == .listening }

    /// The one line the card renders beside the composer, or none. Idle and
    /// listening say nothing: the key's own fill is already saying it.
    public var notice: String? {
      switch self {
      case .idle, .listening: return nil
      case .denied(let line), .unavailable(let line): return line
      }
    }
  }

  public private(set) var state: State = .idle

  /// The current partial — replaced wholesale every time recognition refines
  /// what it heard. It is not an append-only log: "get status" becoming
  /// "git status" arrives as the WHOLE phrase again, which is why the card
  /// replaces a span in the draft rather than appending twice.
  public private(set) var transcript: String = ""

  /// Each refinement, as it arrives. The card turns this into the draft's tail.
  public var onPartial: ((String) -> Void)?
  /// The text that stands, once — recognition ended, or the key was tapped
  /// again. After this the tail is ordinary draft and the next dictation
  /// appends after it rather than over it.
  public var onFinal: ((String) -> Void)?

  // MARK: - The honest lines
  //
  // Lowercase, one sentence, no punctuation at the end: the card's register
  // (see the session card's "not shared for attach"). Each says what is true
  // and, where there is one, what to do about it.

  static let microphoneDenied = "microphone access is off for VibeField — Settings › Privacy"
  static let speechDenied = "speech recognition is off for VibeField — Settings › Privacy"
  static let noRecognizer = "speech recognition is not available on this device"
  static let recognizerBusy = "speech recognition is not available right now"
  static let noMicrophone = "this device has no microphone to listen with"
  static let audioUnavailable = "the microphone could not be opened"

  /// How long a notice stands. The same three seconds the latch's arm window
  /// uses — one clock in this card, so a line that appears and a modifier that
  /// expires feel like the same app rather than two.
  static let noticeWindow: Double = 3

  #if DEBUG
    /// `-vf-demo-input-dictating`: hold the LISTENING look with no microphone.
    ///
    /// Listening is the one state worth a screenshot and the one a headless
    /// run cannot reach: it wants two permission alerts answered and a voice
    /// to speak into a simulator. Set from `HomeScreen`'s DEBUG block
    /// before the card is mounted. It forces the FACE and touches neither
    /// Speech nor the audio session: a fixture for looking at our own pixels,
    /// never a claim that anything was heard. It cannot exist in Release.
    public static var demoListening = false
  #endif

  @ObservationIgnored private var engine: AVAudioEngine?
  @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
  @ObservationIgnored private var task: SFSpeechRecognitionTask?
  /// The notice's clock, held so a second failure replaces the first line
  /// rather than inheriting the leftover of its window.
  @ObservationIgnored private var noticeTask: Task<Void, Never>?

  public init() {
    #if DEBUG
      if Self.demoListening { state = .listening }
    #endif
  }

  // MARK: - Acts

  /// Tap the mic. Asks for what it needs the first time and then listens.
  ///
  /// Authorization is TWO grants, asked in the order Apple's own dictation
  /// asks them: speech recognition, then the microphone. They fail differently
  /// and are worth different sentences — a phone that will not transcribe is a
  /// different problem from one that will not listen.
  public func start() {
    guard !state.isListening else { return }
    #if DEBUG
      if Self.demoListening {
        announce(.listening)
        return
      }
    #endif
    guard let recognizer = Self.makeRecognizer() else {
      announce(.unavailable(Self.noRecognizer))
      return
    }
    guard recognizer.isAvailable else {
      announce(.unavailable(Self.recognizerBusy))
      return
    }
    transcript = ""
    // The Task inherits this actor, so the recognizer rides along without
    // crossing an isolation boundary — and the two system alerts land one
    // after the other rather than both at once.
    Task {
      guard await Self.authorizeSpeech() else {
        self.announce(.denied(Self.speechDenied))
        return
      }
      guard await AVAudioApplication.requestRecordPermission() else {
        self.announce(.denied(Self.microphoneDenied))
        return
      }
      self.listen(with: recognizer)
    }
  }

  /// Tap the mic again. What is on screen is what stands — `onFinal` carries
  /// exactly the partial the user was reading when they stopped, so the text
  /// never changes under the finger that ended it.
  public func stop() {
    finish()
  }

  /// The notice's window elapsed. Public for the same reason the model's
  /// `latchExpired` is: the clock belongs to this type, and a caller with a
  /// reason to end the line early should not have to wait three seconds.
  public func clearNotice() {
    guard state.notice != nil else { return }
    noticeTask?.cancel()
    noticeTask = nil
    state = .idle
  }

  // MARK: - Listening

  private func listen(with recognizer: SFSpeechRecognizer) {
    do {
      try Self.activateAudioSession()
    } catch {
      announce(.unavailable(Self.audioUnavailable))
      return
    }

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.taskHint = .dictation
    // On this device when this device can: the phone transcribes without the
    // audio leaving it. When it cannot, the usage string is what already said
    // so, in one sentence, before the first grant.
    if recognizer.supportsOnDeviceRecognition {
      request.requiresOnDeviceRecognition = true
    }

    let engine = AVAudioEngine()
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    // A device with no input route — and a simulator whose host has no audio
    // input selected — hands back a zero-channel format, and `installTap` on
    // one TRAPS rather than throws. Checking is the difference between an
    // honest line and a crash report.
    guard format.channelCount > 0 else {
      announce(.unavailable(Self.noMicrophone))
      Self.deactivateAudioSession()
      return
    }

    // The tap runs on the audio render thread and its whole job is to hand
    // buffers to the request. `nonisolated(unsafe)` says that out loud:
    // appending is the one Speech call documented to come from off the main
    // thread, and there is no isolation the compiler could check it against.
    nonisolated(unsafe) let buffers = request
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
      buffers.append(buffer)
    }
    engine.prepare()
    do {
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      announce(.unavailable(Self.audioUnavailable))
      Self.deactivateAudioSession()
      return
    }

    self.engine = engine
    self.request = request
    self.task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      // Everything that crosses back is a value: the handler is called on the
      // recognizer's own queue, so the objects stay on that side of the hop
      // and only what is Sendable rides home.
      let text = result?.bestTranscription.formattedString
      let isFinal = result?.isFinal ?? false
      let failed = error != nil
      Task { @MainActor in
        self?.receive(text: text, isFinal: isFinal, failed: failed)
      }
    }
    announce(.listening)
  }

  /// One refinement, or the end of the run.
  ///
  /// A failure still COMMITS what was heard: the partial is already in the
  /// draft where the user can read it, and leaving the span open would let the
  /// next dictation overwrite words they watched settle.
  private func receive(text: String?, isFinal: Bool, failed: Bool) {
    guard state.isListening else { return }
    if let text, text != transcript {
      transcript = text
      onPartial?(text)
    }
    if isFinal || failed { finish() }
  }

  /// Teardown, and the one commit. Idempotent: `state.isListening` is the
  /// guard, and it is false by the time this returns.
  private func finish() {
    if let engine {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
      self.engine = nil
      // Deactivated only when this session actually took the audio route.
      // Releasing one nobody claimed would duck and unduck another app's
      // sound for nothing.
      Self.deactivateAudioSession()
    }
    request?.endAudio()
    request = nil
    task?.cancel()
    task = nil
    guard state.isListening else { return }
    state = .idle
    onFinal?(transcript)
  }

  /// Move to a state and, when it has a line, start that line's window.
  private func announce(_ next: State) {
    noticeTask?.cancel()
    noticeTask = nil
    state = next
    guard next.notice != nil else { return }
    noticeTask = Task { [weak self] in
      try? await Task.sleep(for: .seconds(Self.noticeWindow))
      guard !Task.isCancelled else { return }
      self?.clearNotice()
    }
  }

  // MARK: - The system, asked honestly

  /// The user's locale first, the system's default second, nil third — and nil
  /// is a real answer: `SFSpeechRecognizer` has no recognizer for every locale
  /// a phone can be set to.
  private static func makeRecognizer() -> SFSpeechRecognizer? {
    SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer()
  }

  /// The status is asked before it is requested, so a grant already given
  /// costs no round trip and shows no alert.
  private static func authorizeSpeech() async -> Bool {
    if SFSpeechRecognizer.authorizationStatus() == .authorized { return true }
    return await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { status in
        continuation.resume(returning: status == .authorized)
      }
    }
  }

  /// `.record` with `.duckOthers` — a podcast drops under the voice instead of
  /// fighting it — and `.measurement`, which turns off the processing that
  /// would otherwise reshape speech on its way to the recognizer.
  ///
  /// The option is a courtesy, so it is not allowed to cost the mic: a session
  /// that refuses it (`duckOthers` is documented against the playback
  /// categories) falls back to plain `.record` rather than failing the tap.
  private static func activateAudioSession() throws {
    let audio = AVAudioSession.sharedInstance()
    do {
      try audio.setCategory(.record, mode: .measurement, options: [.duckOthers])
    } catch {
      try audio.setCategory(.record, mode: .measurement)
    }
    try audio.setActive(true, options: .notifyOthersOnDeactivation)
  }

  private static func deactivateAudioSession() {
    try? AVAudioSession.sharedInstance().setActive(
      false, options: .notifyOthersOnDeactivation)
  }
}
