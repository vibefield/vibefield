// The declared-schema row (§5.4 item 2 "schema compile", doctor check 9). Every
// JSON Schema a manifest carries — settings properties, dynamic service method
// input/output/snapshot/delta, command args — is compiled with the SAME ajv
// settings the daemon uses (`service-registry.ts`: allErrors off, strict off),
// so a schema that compiles here compiles there.

import type { PluginManifestV1 } from "@vibefield/contracts";
import { Ajv } from "ajv";
import { jsonPointer, pass, refuse, type Verdict } from "./verdict";

interface DeclaredSchema {
  readonly path: (string | number)[];
  readonly schema: unknown;
  /** how the verdict names it to a human */
  readonly label: string;
}

export function collectDeclaredSchemas(manifest: PluginManifestV1): DeclaredSchema[] {
  const out: DeclaredSchema[] = [];
  const c = manifest.contributes ?? {};

  for (const [key, prop] of Object.entries(c.settings?.properties ?? {})) {
    out.push({
      path: ["contributes", "settings", "properties", key, "schema"],
      schema: prop.schema,
      label: `settings.${key}`,
    });
  }

  (c.services ?? []).forEach((service, si) => {
    service.methods.forEach((method, mi) => {
      const base = ["contributes", "services", si, "methods", mi];
      const parts: Array<[string, unknown]> =
        method.kind === "subscription"
          ? [
              ["input", method.input],
              ["snapshot", method.snapshot],
              ["delta", method.delta],
            ]
          : [
              ["input", method.input],
              ["output", method.output],
            ];
      for (const [name, schema] of parts) {
        out.push({
          path: [...base, name],
          schema,
          label: `${service.namespace}.${method.name} ${name}`,
        });
      }
    });
  });

  (c.commands ?? []).forEach((command, ci) => {
    if (command.args === undefined) return;
    out.push({
      path: ["contributes", "commands", ci, "args"],
      schema: command.args,
      label: `command ${command.id} args`,
    });
  });

  return out;
}

export function checkSchemas(manifest: PluginManifestV1): Verdict[] {
  const declared = collectDeclaredSchemas(manifest);
  if (declared.length === 0)
    return [pass("schema", "no declared JSON Schemas (nothing to compile)")];

  const verdicts: Verdict[] = [];
  // One Ajv per run: a fresh instance per schema would lose $ref sharing and
  // cost nothing here, but reusing one mirrors the daemon's single registry.
  const ajv = new Ajv({ allErrors: false, strict: false });
  let compiled = 0;
  for (const entry of declared) {
    try {
      ajv.compile(entry.schema as object);
      compiled++;
    } catch (error) {
      verdicts.push(
        refuse(
          "schema",
          "schema-invalid",
          `${entry.label} does not compile: ${error instanceof Error ? error.message : String(error)}`,
          { pointer: jsonPointer(entry.path) },
        ),
      );
    }
  }
  if (compiled === declared.length)
    verdicts.push(pass("schema", `${compiled} declared schema(s) compile under ajv`));
  return verdicts;
}
