#if DEBUG
  import Foundation

  /// `-vf-demo-field-slice-signed-out[=<seconds>]` (WI-1's OWED witness, 2026-11-04) — rides on
  /// `-vf-demo-field-slice` as `-vf-mock-signed-out` rides on `-vf-mock`. The slice's link is installed as always and
  /// its board, the witness's open, arrives only once the tabs are down, under the way in's welcome. After the seconds
  /// (4 when none are given) the phone signs in by itself, with no input and no board change: the welcome yields
  /// through the real decision, WI-2's found beat holds, and the tabs mount on what the field folded while they were
  /// away. Then the witness reads the field (`reading`).
  ///
  /// It cannot run in Release. The witness is the Debug app's, with `-vf-auto-open-card=<visual id>` (README).
  enum FieldSliceSignIn {
    static let argument = "-vf-demo-field-slice-signed-out"
    static let slice = "-vf-demo-field-slice"
    static let defaultDelay: Duration = .seconds(4)
    /// The body the witness reads for: an idle terminal on Studio, the slice's home, in the witness's open.
    static let witnessBody = "pty-h1"

    /// How long the welcome stands before the sign-in, or nil when the launch does not stamp it over the slice.
    static func launch(_ arguments: [String]) -> Duration? {
      guard arguments.contains(slice),
        let stamp = arguments.first(where: { $0 == argument || $0.hasPrefix(argument + "=") })
      else { return nil }
      guard let seconds = Int(stamp.dropFirst(argument.count + 1)), seconds > 0 else { return defaultDelay }
      return .seconds(seconds)
    }

    /// The witness's reading, printed after the sign-in and the found beat: how many bodies the field holds, and
    /// whether the witness's body is one of them. 0 and absent is the tabs mounted on nothing.
    static func reading(_ bodies: [String]) -> String {
      let drawn = bodies.contains(witnessBody) ? "drawn" : "absent"
      return "[field-slice] after the sign-in the field holds \(bodies.count) bodies (\(witnessBody) \(drawn))"
    }

    /// The way in's page over the slice, through the real decision: the welcome signed out, none signed in.
    static func door(signedIn: Bool) -> FieldHomeModel.DoorPage? {
      FieldHomeModel.doorPage(
        fixtureOwnsTheField: false, meshState: signedIn ? .up : .off, rememberedLogin: nil,
        login: signedIn ? AccountFixtures.login : nil, isGated: true, hasListed: true, listed: signedIn ? 1 : 0,
        remembered: 0, machineName: AccountFixtures.machine, adminConsole: nil, signInNote: nil)
    }
  }
#endif
