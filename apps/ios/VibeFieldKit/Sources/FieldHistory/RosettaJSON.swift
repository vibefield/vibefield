import RosettaClient

// FieldProduct and RosettaClient both export a `JSONValue`, and a file that imports both cannot name rosetta's: the
// module has a class of its own name, so `RosettaClient.JSONValue` reads as a member of that class. This file imports
// rosetta alone and gives its value the one name the direct reader uses.

/// rosetta's whole-JSON value, as a row's fields carry it.
typealias RosettaJSON = JSONValue
