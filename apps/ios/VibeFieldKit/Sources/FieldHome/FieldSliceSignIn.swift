#if DEBUG
  import Foundation

  /// `-vf-demo-field-slice-signed-out[=<seconds>]` (WI-1's OWED witness, 2026-11-04) — rides on
  /// `-vf-demo-field-slice` as `-vf-mock-signed-out` rides on `-vf-mock`. The slice's link is installed as always and
  /// its board, the witness's open, folds while the way in's welcome stands over it. After the seconds (4 when none
  /// are given) the phone signs in by itself, with no input and no board change: the welcome yields through the real
  /// decision, WI-2's found beat holds, and the tabs mount on what the field folded while they were away.
  ///
  /// It cannot run in Release. The witness is the Debug app's, with `-vf-auto-open-card=<visual id>` (README).
  enum FieldSliceSignIn {
    static let argument = "-vf-demo-field-slice-signed-out"
    static let slice = "-vf-demo-field-slice"
    static let defaultDelay: Duration = .seconds(4)

    /// How long the welcome stands before the sign-in, or nil when the launch does not stamp it over the slice.
    static func launch(_ arguments: [String]) -> Duration? {
      nil
    }

    /// The way in's page over the slice, through the real decision: the welcome signed out, none signed in.
    static func door(signedIn: Bool) -> FieldHomeModel.DoorPage? {
      nil
    }
  }
#endif
