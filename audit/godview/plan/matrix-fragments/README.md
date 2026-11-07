# Matrix fragments

One JSON file per role, named `GV-AUDIT2.json`, `GV-AUDIT3.json`, `GV-AUDIT4.json`, `GV-AUDIT05.json`, or `GV-AUDIT6.json`. Shape: `contracts/matrix-fragment.schema.json`.

`rows` add new ids. `updates` change the status of an existing id and must be made by that row's owner, or by GV-AUDIT6 when combining. Do not edit `completeness-matrix.json` from another slice.
