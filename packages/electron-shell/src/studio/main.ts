import { registerDesktopDevelopmentExtension } from "../main/development-extension";
import { createStudioHost } from "./host";

registerDesktopDevelopmentExtension(
  createStudioHost({ openAtStartup: process.env["VIBEFIELD_STUDIO_OPEN"] === "1" }),
);

// Registration must precede evaluation of the ordinary product composition.
// A dynamic import gives the Studio entry that ordering without making the
// production entry import any Studio module.
void import("../main/index");
