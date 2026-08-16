export interface RuntimeArtifactIdentity {
  readonly installRevision: string;
  readonly manifestHash: string;
  readonly approvedModuleGeneration?: number;
}

interface RuntimeTargetBase {
  readonly pluginId: string;
  readonly artifact: RuntimeArtifactIdentity;
  /** Hash of the APIs/constraints visible to this face, not the registry-wide grant counter. */
  readonly authorityFingerprint: string;
  /** Audit and credential-rotation provenance. Deliberately excluded from semantic equality. */
  readonly observedGrantGeneration: number;
  readonly runtimeGeneration?: string;
}

export interface ServiceRuntimeTarget extends RuntimeTargetBase {
  readonly face: "service";
  readonly instanceKey: { readonly deviceId: string };
}

export interface RendererRuntimeTarget extends RuntimeTargetBase {
  readonly face: "renderer";
  readonly instanceKey: { readonly windowId: string };
}

export interface BehaviorRuntimeTarget extends RuntimeTargetBase {
  readonly face: "behavior";
  readonly instanceKey: {
    readonly windowId: string;
    readonly documentId: string;
    readonly behaviorDeclarationId: string;
  };
  readonly runtimeGeneration: string;
}

export type PluginRuntimeTarget =
  | ServiceRuntimeTarget
  | RendererRuntimeTarget
  | BehaviorRuntimeTarget;

function sameArtifact(left: RuntimeArtifactIdentity, right: RuntimeArtifactIdentity): boolean {
  return (
    left.installRevision === right.installRevision &&
    left.manifestHash === right.manifestHash &&
    left.approvedModuleGeneration === right.approvedModuleGeneration
  );
}

/** Exact structured comparison for controller reconciliation. A broad grant-generation change
 * rotates credentials but does not reload a face whose projected authority stayed identical. */
export function samePluginRuntimeTarget(
  left: PluginRuntimeTarget | null,
  right: PluginRuntimeTarget | null,
): boolean {
  if (left === right) return true;
  if (left === null || right === null || left.face !== right.face) return false;
  if (
    left.pluginId !== right.pluginId ||
    !sameArtifact(left.artifact, right.artifact) ||
    left.authorityFingerprint !== right.authorityFingerprint ||
    left.runtimeGeneration !== right.runtimeGeneration
  ) {
    return false;
  }

  switch (left.face) {
    case "service":
      return right.face === "service" && left.instanceKey.deviceId === right.instanceKey.deviceId;
    case "renderer":
      return right.face === "renderer" && left.instanceKey.windowId === right.instanceKey.windowId;
    case "behavior":
      return (
        right.face === "behavior" &&
        left.instanceKey.windowId === right.instanceKey.windowId &&
        left.instanceKey.documentId === right.instanceKey.documentId &&
        left.instanceKey.behaviorDeclarationId === right.instanceKey.behaviorDeclarationId
      );
  }
}
