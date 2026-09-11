import FieldDesign
import SwiftUI

/// The mic, between the field and Send.
///
/// The desktop Composer's foot fixes the order — attach at the far left, mic
/// immediately left of send, send the one inverted-solid control — and the
/// phone card's row 1 is that foot verbatim. This is its third control.
///
/// **What a tap means.** It toggles listening, and while it listens the circle
/// goes from `.circle.quiet` to `.circle.prominent` and breathes on the field's
/// own slow period. Nothing about it is a recording indicator — the system's
/// own is on the screen above — it is the state of one control on one card.
///
/// **Draft only, on purpose.** The design gives Live's strip the same mic, but
/// dictation LANDS IN THE DRAFT and Live has no draft on screen. A mic there
/// would either type into the terminal, which this slice exists to refuse, or
/// fill a field the user cannot see. So it is absent in Live rather than
/// present and lying, which is D-i6 read the way the rest of this card reads
/// it.
struct DictationKey: View {

  /// The card's model. It outlives this key — `HomeScreen` holds ONE
  /// `InputCardModel` for the screen's life and `reset()` is how a new session
  /// gets a new draft — so the callbacks installed on appear stay pointed at
  /// the right draft.
  let model: InputCardModel

  @State private var session = DictationSession()
  /// The breath. Flipped when listening starts and stops; the animation
  /// attached to it is what repeats.
  @State private var breathing = false
  // --- IOS-5e ---------------------------------------------------------------
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  // --- end IOS-5e -----------------------------------------------------------

  /// How far the control's opacity falls at the bottom of a breath. Far enough to
  /// read as alive across the room, near enough that a screenshot caught at
  /// any point in the cycle still shows an inverted key.
  private static let breathFloor: Double = 0.62

  private var listening: Bool { session.state.isListening }
  /// The composer row's `.target`, and the `.circle` centred in it.
  private var side: CGFloat { InputCardMetrics.rowHeight(for: dynamicTypeSize) }
  private var circleSide: CGFloat { InputCardMetrics.circleDiameter(for: dynamicTypeSize) }

  var body: some View {
    Button {
      if listening {
        session.stop()
        // Soft to end, light to begin: the latch's own textures, because the
        // thing they say is the same one — a mode the next thing lands in
        // just opened or closed. Haptics are the view's, never the model's.
        InputHaptics.release()
      } else {
        session.start()
        InputHaptics.arm()
      }
    } label: {
      Image(systemName: "mic")
        .font(
          .system(size: InputCardMetrics.actionGlyphSize(for: dynamicTypeSize), weight: .semibold)
        )
        .foregroundStyle(
          listening ? ChromePalette.circleProminentInk : ChromePalette.circleQuietInk
        )
        .frame(width: circleSide, height: circleSide)
        .background { circleShape }
        .frame(width: side, height: side)
        // --- IOS-5e ---------------------------------------------------------
        // Under Reduce Motion the control does not breathe. It still turns
        // PROMINENT while it listens, which is the state itself and not the
        // decoration — what goes is the slow pulse, which is a forever-repeating
        // animation on screen and the exact shape the setting exists to stop.
        // The state is not lost with it: the fill says listening, the label says
        // "Dictating, tap to stop", and IOS-5e's announcements say the rest.
        .opacity(!reduceMotion && listening && breathing ? Self.breathFloor : 1)
        .animation(breath, value: breathing)
        // --- end IOS-5e -----------------------------------------------------
    }
    .buttonStyle(ChromePressStyle())
    .accessibilityLabel(listening ? "Dictating, tap to stop" : "Dictate into the draft")
    .overlay(alignment: .topTrailing) { notice }
    // One curve for everything the state changes: the key's fill crossing to
    // inverted, and the line arriving or leaving above it.
    .animation(FieldMotion.ease(0.18), value: session.state)
    .onAppear {
      // The partial stream and the one commit, wired to the draft. `[model]`
      // rather than `self`: the closures outlive this view struct, which
      // SwiftUI rebuilds on every card update.
      session.onPartial = { [model] text in model.appendDictation(text) }
      session.onFinal = { [model] text in
        if !text.isEmpty { model.appendDictation(text) }
        model.commitDictation()
      }
      breathing = listening
    }
    .onChange(of: listening) { _, now in
      breathing = now
      // A run that ended on its own — silence, or the recognizer's own limit —
      // leaves the tail committed by `onFinal`; this only stops the breath.
    }
    .onDisappear {
      // The card closed with the mic open. Stopping releases the audio route
      // and commits what was heard; leaving it running would keep a hot
      // microphone behind a card nobody is looking at.
      if listening { session.stop() }
    }
  }

  /// One line, above the row rather than under it.
  ///
  /// The card is 110 pt inside a `safeAreaInset` and the terminal's grid
  /// follows its height through `onGridSize → setViewport`; growing it for
  /// three seconds would reflow the whole screen twice to say one sentence. So
  /// the line is drawn OUTSIDE the card's bounds, anchored to the key that
  /// raised it — the same reason `KeyPopover` gives for drawing fans up there.
  @ViewBuilder
  private var notice: some View {
    if let line = session.state.notice {
      Text(line)
        // IOS-5e: this line is a sentence, so it is set as one — the sheet
        // body's step, on the floating surface the menus use.
        .font(ChromeType.sans(InputCardMetrics.labelSize(for: dynamicTypeSize)))
        .foregroundStyle(ChromePalette.ink)
        .multilineTextAlignment(.trailing)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: 240, alignment: .trailing)
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background { ChromeMaterial.floating(radius: ChromeRadius.well) }
        // The overlay's top guide moved to its own bottom: the line sits
        // wholly above the key, clear of the composer it belongs to.
        .alignmentGuide(.top) { $0[.bottom] + 8 }
        .allowsHitTesting(false)
        .transition(.opacity)
        .animation(FieldMotion.ease(0.18), value: session.state)
    }
  }

  /// Slow in, slow out, forever — `breathePeriod` is a whole cycle, so half of
  /// it is one direction. The way back to rest is a plain ease: a key that
  /// stopped listening should settle, not fade out of a rhythm.
  private var breath: Animation {
    // IOS-5e: nothing repeating under Reduce Motion, in either direction — a
    // curve back to rest is still a curve, and there is nothing to come back
    // from when the key never left.
    if reduceMotion { return FieldMotion.ease(0.12) }
    return listening
      ? .easeInOut(duration: FieldMotion.breathePeriod / 2).repeatForever(autoreverses: true)
      : FieldMotion.ease(0.12)
  }

  /// `.circle.quiet` at rest, `.circle.prominent` while it listens.
  @ViewBuilder
  private var circleShape: some View {
    if listening {
      ChromeMaterial.circle(fill: ChromePalette.circleProminentFill, hairline: nil)
    } else {
      ChromeMaterial.circle(
        fill: ChromePalette.circleQuietFill, hairline: ChromePalette.circleHairline)
    }
  }
}
