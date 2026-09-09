import FieldDesign
import FieldTerminal
import SwiftUI

/// Where a host's mirror-write key is entered (IOS-3c).
///
/// The sheet is deliberately one-way: it takes a secret and it removes one,
/// and it never reads the stored value back. There is no field to prefill and
/// nothing to reveal — a key on screen is a key in a screenshot, and the only
/// question this sheet can honestly answer is "does this phone hold one",
/// which is what `hasKey` carries.
///
/// The one sentence names the desktop's env var because that is where the
/// value comes from: without it the user is being asked for a secret with no
/// way to know which secret.
struct WriteKeySheet: View {
  private let host: MirrorWriteHost
  private let hasKey: Bool
  private let onSave: (String) -> Void
  private let onRemove: () -> Void

  @State private var secret = ""

  init(
    host: MirrorWriteHost,
    hasKey: Bool,
    onSave: @escaping (String) -> Void,
    onRemove: @escaping () -> Void
  ) {
    self.host = host
    self.hasKey = hasKey
    self.onSave = onSave
    self.onRemove = onRemove
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      // `textMuted`, not the settings sheet's `textFaint`: this sheet is a
      // short one and sits over the FIELD, where a bright bubble behind the
      // glass leaves a faint eyebrow unreadable in light mode. The card's own
      // eyebrow (SessionCardView's "TERMINAL") made the same call for the same
      // reason — checked in the simulator, both themes.
      Text("WRITE KEY")
        .font(FieldType.mono(9, .heavy))
        .tracking(FieldType.tracking(0.18, of: 9))
        .foregroundStyle(FieldPalette.textMuted)

      Text(host.deviceName)
        .font(FieldType.mono(12, .medium))
        .foregroundStyle(FieldPalette.textMain)
        .padding(.top, 6)

      Text(
        "the value of FIELD_NATIVE_TERMINAL_MIRROR_WRITE in the desktop's environment — "
          + "stored in this phone's keychain, never synced"
      )
      .font(FieldType.mono(9))
      .foregroundStyle(FieldPalette.textMuted)
      .fixedSize(horizontal: false, vertical: true)
      .padding(.top, 10)

      field
        .padding(.top, 16)

      acts
        .padding(.top, 16)

      Spacer(minLength: 0)
    }
    .padding(.horizontal, 22)
    .padding(.top, 26)
    .frame(maxWidth: .infinity, alignment: .leading)
    // No background: the sheet's liquid glass is the surface (MeshSheet's rule).
  }

  /// The settings sheet's search-field shape, with dots instead of glyphs.
  /// The placeholder is drawn rather than passed to `SecureField` because the
  /// system's own prompt cannot be put in the mono voice.
  private var field: some View {
    ZStack(alignment: .leading) {
      if secret.isEmpty {
        Text("paste the key")
          .font(FieldType.mono(11))
          .foregroundStyle(FieldPalette.textFaint)
          .allowsHitTesting(false)
          .accessibilityHidden(true)
      }
      SecureField("", text: $secret)
        .textFieldStyle(.plain)
        .font(FieldType.mono(11))
        .foregroundStyle(FieldPalette.textMain)
        .tint(FieldPalette.textMain)
        .autocorrectionDisabled()
        .textInputAutocapitalization(.never)
        .textContentType(.password)
        .submitLabel(.done)
        .onSubmit { save() }
        .accessibilityLabel("Write key for \(host.deviceName)")
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 9)
    .background(RoundedRectangle(cornerRadius: 6).fill(FieldPalette.panelBackground.opacity(0.45)))
    .overlay(
      RoundedRectangle(cornerRadius: 6).strokeBorder(FieldPalette.panelBorder, lineWidth: 1))
  }

  private var acts: some View {
    HStack(spacing: 10) {
      Button(action: save) {
        Text("SAVE")
          .font(FieldType.mono(11, .heavy))
          .tracking(FieldType.tracking(0.12, of: 11))
          .foregroundStyle(FieldPalette.panelBackground)
          .padding(.horizontal, 18)
          .padding(.vertical, 9)
          .background(RoundedRectangle(cornerRadius: 8).fill(FieldPalette.textMain))
      }
      .buttonStyle(.plain)

      if hasKey {
        // Only when there is something to remove. A REMOVE that is always
        // there would be a control that does nothing on the run where it
        // matters most — the first one (D-i6).
        Button(action: onRemove) {
          Text("REMOVE")
            .font(FieldType.mono(11, .heavy))
            .tracking(FieldType.tracking(0.12, of: 11))
            .foregroundStyle(FieldPalette.textMain)
            .padding(.horizontal, 18)
            .padding(.vertical, 9)
            .overlay(
              RoundedRectangle(cornerRadius: 8)
                .strokeBorder(FieldPalette.panelBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
      }
    }
  }

  /// An empty save is a no-op and the field stays open — the alternative is a
  /// greyed-out SAVE, which is the disabled-looking control D-i6 forbids.
  /// Whitespace is trimmed because the value is usually pasted out of a shell,
  /// and a trailing newline in a token is a refusal the host cannot explain.
  private func save() {
    let trimmed = secret.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    onSave(trimmed)
  }
}
