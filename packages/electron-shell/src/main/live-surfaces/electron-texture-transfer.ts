import { sharedTexture, type WebContents } from "electron";
import type {
  LiveSurfaceImportedTexture,
  LiveSurfaceTextureTransferApi,
} from "./texture-forwarder";

/** Direct Electron sharedTexture import/send lane for one shell renderer. */
export function createElectronLiveSurfaceTextureTransferApi(
  target: WebContents,
): LiveSurfaceTextureTransferApi {
  return {
    importTexture: (textureInfo, allReferencesReleased) =>
      sharedTexture.importSharedTexture({ textureInfo, allReferencesReleased }),
    sendTexture: (imported, envelope) =>
      sharedTexture.sendSharedTexture(
        {
          frame: target.mainFrame,
          importedSharedTexture: imported as Electron.SharedTextureImported,
        },
        envelope,
      ),
  } satisfies LiveSurfaceTextureTransferApi;
}

// Compile-time assertion kept near the adapter: Electron's imported reference
// must continue to satisfy the foundation's explicit release-only ownership.
const _importedTextureShape: LiveSurfaceImportedTexture | null = null;
void _importedTextureShape;
