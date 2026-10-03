import { hydrateRoot } from "react-dom/client";
import { FieldmarksReport } from "./FieldmarksReport";
import "@vibefield/design-kit/tokens.css";
import "./styles/fieldmarks.css";
import "./styles/fieldmarks-report.css";

declare const __VF_FIELDMARKS_ARCHIVE__: string;
const root = document.getElementById("fieldmarks-root");
if (root) hydrateRoot(root, <FieldmarksReport archiveUrl={__VF_FIELDMARKS_ARCHIVE__} />);
