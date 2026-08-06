import type { ReactElement } from "react";
import type { DocManagerApi, DocManagerState } from "../doc-manager";
import { FilePill } from "../hud/FilePill";

const PREVIEW_STATE: DocManagerState = {
  phase: "ready",
  loading: null,
  doc: { docId: "1f0d7a2e-3c44-4b8a-9e51-6d2f8c0a7b19", name: "Launch notes" },
  docs: [
    {
      docId: "1f0d7a2e-3c44-4b8a-9e51-6d2f8c0a7b19",
      name: "Launch notes",
      updatedAt: Date.now() - 45_000,
      baseEpoch: 0,
      engineSchema: 2,
      sizeBytes: 18_240,
    },
    {
      docId: "2a1b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d",
      name: "Agent research",
      updatedAt: Date.now() - 12 * 60_000,
      baseEpoch: 0,
      engineSchema: 2,
      sizeBytes: 42_812,
    },
    {
      docId: "7c8d9e0f-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
      name: "Product map",
      updatedAt: Date.now() - 2 * 60 * 60_000,
      baseEpoch: 0,
      engineSchema: 2,
      sizeBytes: 31_204,
      syncIntent: "local",
    },
  ],
  thumbnailUrls: {},
  pending: null,
};

const PREVIEW_MANAGER: DocManagerApi = {
  subscribe: () => () => undefined,
  getState: () => PREVIEW_STATE,
  refreshDocs: async () => PREVIEW_STATE.docs,
  rename: async () => undefined,
  createDoc: async () => undefined,
  switchTo: async () => undefined,
  setSyncIntent: async () => undefined,
};

/** Runtime-free adapter around the exact production FilePill. */
export function FilePillPreview({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  return <FilePill manager={PREVIEW_MANAGER} open={open} onOpenChange={onOpenChange} />;
}
