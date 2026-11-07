import { AUDIT_PINS } from "./contract.mjs";

/**
 * Source revision gate. Audited fixtures, renders and traces must cite the
 * pinned revisions. A different puppeteer commit, including the shipped
 * v0.3.3 commit, is mixed input and is not joined as end-to-end proof.
 * The record stays visible so the rejection is inspectable.
 */

export function readRevision(record) {
  if (!record || typeof record !== "object") return null;
  const rev = record.sourceRevision ?? record.pins;
  if (!rev || typeof rev !== "object" || Array.isArray(rev)) return null;
  const vibefield = typeof rev.vibefield === "string" ? rev.vibefield : "";
  const puppeteer = typeof rev.puppeteer === "string" ? rev.puppeteer : "";
  if (!vibefield && !puppeteer) return null;
  return { vibefield, puppeteer };
}

export function revisionGate(record) {
  const rev = readRevision(record);
  if (!rev) {
    return {
      admit: false,
      code: "revision-unspecified",
      sourceRevision: null,
      problems: ["revision-unspecified"],
    };
  }
  const problems = [];
  if (rev.vibefield !== AUDIT_PINS.vibefield) problems.push("vibefield-revision-mismatch");
  if (rev.puppeteer !== AUDIT_PINS.puppeteer) problems.push("puppeteer-revision-mismatch");
  return {
    admit: problems.length === 0,
    code: problems.length === 0 ? "admit" : "mixed-input",
    sourceRevision: rev,
    problems,
  };
}

/** A citation inside the model contract. `commit` must match the repo's pin. */
export function citationGate(link) {
  if (!link || typeof link !== "object") {
    return { admit: false, code: "citation-unreadable", problems: ["citation-unreadable"] };
  }
  const repo = link.repo;
  const sha = typeof link.commit === "string" ? link.commit : link.sha;
  if (repo !== "vibefield" && repo !== "puppeteer") {
    return { admit: false, code: "unknown-repo", problems: ["unknown-repo"], sha: sha ?? "" };
  }
  const expected = AUDIT_PINS[repo];
  if (sha !== expected) {
    return {
      admit: false,
      code: "citation-revision-mismatch",
      problems: ["citation-revision-mismatch"],
      sha: sha ?? "",
      expected,
      repo,
    };
  }
  return { admit: true, code: "admit", problems: [], sha, repo };
}

export function sameRevision(parts) {
  const gates = parts.map((part) => revisionGate(part));
  if (gates.some((gate) => !gate.admit)) {
    return { admit: false, code: "mixed-input", gates };
  }
  return { admit: true, code: "admit", gates };
}
