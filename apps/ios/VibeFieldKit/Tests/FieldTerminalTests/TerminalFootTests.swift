import CoreGraphics
import SwiftUI
import Testing

@testable import FieldTerminal

/// PF-18 (2026-11-23; DESIGN.md §8 "The foot and the terminal are one
/// surface"): the terminal's surface runs to the screen's foot under whatever
/// stands over it, and the grid ends above that. The inset under the last row
/// is the renderer's padding plus what the foot's clearance asks beyond the
/// safe area the view already keeps, which ghosttea adds itself.
@Suite struct TerminalFootTests {
  @Test("with nothing said, the inset is the renderer's padding and the view's safe area decides the rest")
  func nothingSaid() {
    #expect(TerminalSurface.footInset(padding: 6, clearance: nil, safeArea: 34) == 6)
    #expect(TerminalSurface.footInset(padding: 6, clearance: nil, safeArea: 0) == 6)
    #expect(EnvironmentValues().terminalFootClearance == nil)
  }

  @Test("the row, the card and the home indicator's strip: the grid ends at the row's top, less the padding")
  func theOpenInput() {
    // Measured 2026-11-23 on an iPhone 17 Pro simulator: 110pt of row and card over a 34pt strip.
    let inset = TerminalSurface.footInset(padding: 6, clearance: 144, safeArea: 34)
    #expect(inset == 116)
    // What the renderer keeps under the last row is this and the safe area: the clearance and the padding.
    let kept: CGFloat = inset + 34
    #expect(kept == CGFloat(150))
  }

  @Test("the keyboard is counted once, whether or not the view's safe area already holds it")
  func theKeyboardOnce() {
    // UIKit's safe area leaves a keyboard out: the whole of it is asked for here.
    let asked: CGFloat = TerminalSurface.footInset(padding: 6, clearance: 446, safeArea: 34)
    #expect(asked == CGFloat(418))
    #expect(asked + 34 == CGFloat(452))
    // A safe area that held the keyboard too would leave only the padding to add.
    #expect(TerminalSurface.footInset(padding: 6, clearance: 446, safeArea: 446) == 6)
    // And one deeper than the clearance never pulls the grid down under the row.
    #expect(TerminalSurface.footInset(padding: 6, clearance: 144, safeArea: 446) == 6)
  }

  @Test("a clearance that is no figure, or below nothing, adds nothing")
  func hostileFigures() {
    #expect(TerminalSurface.footInset(padding: 6, clearance: .nan, safeArea: 34) == 6)
    #expect(TerminalSurface.footInset(padding: 6, clearance: .infinity, safeArea: 34) == 6)
    #expect(TerminalSurface.footInset(padding: 6, clearance: -20, safeArea: 34) == 6)
    #expect(TerminalSurface.footInset(padding: 6, clearance: 144, safeArea: -5) == 150)
  }
}
