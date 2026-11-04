import Foundation
import Testing

@testable import FieldHome

/// WI-1's OWED witness (2026-11-04) — the signed-out field slice's stamp. `-vf-demo-field-slice-signed-out` rides on
/// `-vf-demo-field-slice`: the welcome stands over the slice through the real decision, then the phone signs in by
/// itself, and the found beat hands over with no lock offered. These rows pin the stamp's decision. The witness
/// itself, that the slice's bodies draw after a sign-in with no board change, is the Debug app's: the kit hosts no
/// HomeScreen (README, `-vf-auto-open-card=pty-h1`).
@Suite("the signed-out field slice: the welcome over the slice, then a sign-in by itself")
@MainActor
struct FieldSliceSignInTests {
  private let slice = "-vf-demo-field-slice"
  private let stamp = "-vf-demo-field-slice-signed-out"

  @Test("the stamp rides on the slice: 4 s bare, its own seconds given, nothing without the slice")
  func launch() {
    #expect(FieldSliceSignIn.launch([slice, stamp]) == .seconds(4))
    #expect(FieldSliceSignIn.launch([stamp, slice]) == .seconds(4))
    #expect(FieldSliceSignIn.launch([slice, "\(stamp)=6"]) == .seconds(6))
    #expect(FieldSliceSignIn.launch([slice, "\(stamp)=soon"]) == .seconds(4))
    #expect(FieldSliceSignIn.launch([slice, "\(stamp)=0"]) == .seconds(4))
    #expect(FieldSliceSignIn.launch([slice]) == nil)
    #expect(FieldSliceSignIn.launch([stamp]) == nil)
    #expect(FieldSliceSignIn.launch([]) == nil)
  }

  @Test("signed out, the welcome through the real decision; signed in, no page")
  func door() {
    #expect(FieldSliceSignIn.door(signedIn: false) == .welcome(failure: nil))
    #expect(FieldSliceSignIn.door(signedIn: true) == nil)
  }

  @Test("the sign-in ends the way in: the found beat holds, then the hand-over, with no lock offered")
  func handOver() {
    #expect(
      FieldHomeModel.wayInEnds(
        previous: FieldSliceSignIn.door(signedIn: false), next: FieldSliceSignIn.door(signedIn: true)))
    #expect(FieldHomeModel.afterFoundBeat(offer: nil) == nil)
  }

  @Test("the witness's reading: how many bodies the field holds, and whether pty-h1 is one")
  func reading() {
    #expect(
      FieldSliceSignIn.reading(["run-h-partial", "pty-h1"])
        == "[field-slice] after the sign-in the field holds 2 bodies (pty-h1 drawn)")
    #expect(FieldSliceSignIn.reading([]) == "[field-slice] after the sign-in the field holds 0 bodies (pty-h1 absent)")
  }
}
