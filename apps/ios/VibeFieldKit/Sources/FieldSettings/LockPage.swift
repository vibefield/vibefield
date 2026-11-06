import FieldDesign
import FieldLock
import SwiftUI

/// WI-3 — Settings › This phone › Lock (DESIGN.md §9 "The lock", §8 "The phone's Settings" as built). The switch is
/// the lock itself, **Lock VibeField**, never "Use Face ID" (Apple asks apps not to add their own switch for
/// biometrics); then **Require Face ID** with its four times. Every change asks first, so the switch and the tick show
/// the lock's own state and move only once it has changed: a miss or a Cancel leaves them where they were. Every
/// word names this phone's method (`LockWords`).
struct LockPage: View {
  let lock: FieldLock
  /// A change is asking: the controls wait for its answer.
  @State private var asking = false

  var body: some View {
    let words = lock.words
    List {
      Section {
        Toggle(
          isOn: Binding(
            get: { lock.isOn },
            set: { on in change { await lock.setOn(on) } })
        ) {
          ChromeRow(LockWords.toggle)
        }
        .disabled(asking || (lock.method == LockMethod.none && !lock.isOn))
      } header: {
        ChromeListHead(tags: [FactTag(DeviceWord.current.This)])
      } footer: {
        ChromeListFoot(lock.switchFoot(device: DeviceWord.current.noun))
      }
      .chromeRows()
      if lock.isOn {
        Section {
          ForEach(LockDelay.allCases, id: \.self) { delay in
            delayRow(delay, selected: lock.delay == delay)
          }
        } header: {
          ChromeListHead(words.requireHead)
        } footer: {
          ChromeListFoot(words.requireFoot)
        }
        .chromeRows()
      }
    }
    .chromeList()
    .navigationTitle(LockWords.row)
    .navigationBarTitleDisplayMode(.inline)
  }

  private func delayRow(_ delay: LockDelay, selected: Bool) -> some View {
    Button {
      guard !selected else { return }
      change { await lock.setDelay(delay) }
    } label: {
      HStack(spacing: 12) {
        Text(LockWords.delay(delay))
          .font(ChromeListType.row)
          .foregroundStyle(ChromePalette.ink)
          .alignmentGuide(.listRowSeparatorLeading) { $0[.leading] }
        Spacer(minLength: 8)
        if selected {
          FieldGlyph(.check, size: 18)
            .foregroundStyle(ChromePalette.ink)
            .accessibilityHidden(true)
        }
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(asking)
    .accessibilityLabel(LockWords.delay(delay))
    .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
  }

  /// One change at a time: the ask is the lock's, and the page shows its answer.
  private func change(_ ask: @escaping @MainActor () async -> Bool) {
    guard !asking else { return }
    asking = true
    Task {
      _ = await ask()
      asking = false
    }
  }
}
