import { hydrateRoot } from "react-dom/client";
import { FaceStickersReport } from "./FaceStickersReport";
import "@vibefield/design-kit/tokens.css";
import "./styles/fieldmarks.css";
import "./styles/face-stickers.css";

declare const __VF_FACE_STICKERS_ARCHIVE__: string;
const root = document.getElementById("face-stickers-root");
if (root) hydrateRoot(root, <FaceStickersReport archiveUrl={__VF_FACE_STICKERS_ARCHIVE__} />);
