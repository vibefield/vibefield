import FieldDesign
import Testing

@testable import FieldTerminal

/// IOS-13a S5b (VF-PM 2026-11-05 03:59Z; DESIGN.md §9 "The phone's legal words") — Settings › Terminal names the device
/// as its platform names it. Its two tags (Look, Drawn over the terminal) and Look's foot take `DeviceWord`, as every
/// Settings word does.
@Suite("Settings › Terminal names the device as its platform does")
struct TerminalSettingsWordsTests {
  @Test("its tags and its foot say this iPhone, this iPad or this device, never a phone by hand")
  func deviceNamed() {
    for device in [DeviceWord.iPad, .unknown] {
      let words = [TerminalSettingsWords.tag(device), TerminalSettingsWords.lookFoot(device)]
      for word in words {
        #expect(!word.localizedCaseInsensitiveContains("phone"), "\(device): \(word)")
      }
    }
    #expect(TerminalSettingsWords.tag(.iPad) == "This iPad")
    #expect(TerminalSettingsWords.tag(.iPhone) == "This iPhone")
    #expect(
      TerminalSettingsWords.lookFoot(.iPhone)
        == "A terminal’s text is drawn on the desktop that runs it, so its type and colours are "
        + "that desktop’s. These set the ground this iPhone draws under it.")
  }
}
