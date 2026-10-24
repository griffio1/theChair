// Claude Code PreToolUse hook: checks the PROPOSED file content against the contracts before
// Edit/Write/MultiEdit lands. Exit 2 blocks the edit and sends stderr back to Claude.
// Calls the theChair API (so it shows up on the dashboard); if the API is down, checks
// against the local contracts/*.json so it still works offline.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import type { Contract, ExtractedShape, PreflightResponse } from "../shared/types";
import { extractDeterministic } from "../analyzer/deterministic";
import { preflight } from "../engine/preflight";

interface HookInput {
  cwd?: string;
  tool_name: string;
  tool_input: {
    file_path?: string;
    content?: string;
    old_string?: string;
    new_string?: string;
    replace_all?: boolean;
    edits?: { old_string: string; new_string: string; replace_all?: boolean }[];
  };
}

function applyEdit(text: string, oldS: string, newS: string, all?: boolean): string {
  return all ? text.split(oldS).join(newS) : text.replace(oldS, () => newS);
}

function proposedContent(input: HookInput, abs: string): string | undefined {
  const t = input.tool_input;
  if (input.tool_name === "Write") return t.content;
  const current = existsSync(abs) ? readFileSync(abs, "utf8") : "";
  if (input.tool_name === "Edit" && t.old_string !== undefined && t.new_string !== undefined) {
    return applyEdit(current, t.old_string, t.new_string, t.replace_all);
  }
  if (input.tool_name === "MultiEdit" && t.edits) {
    return t.edits.reduce((acc, e) => applyEdit(acc, e.old_string, e.new_string, e.replace_all), current);
  }
  return undefined;
}

function localContracts(root: string): Contract[] {
  const dir = join(root, "contracts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith(".")) // skip macOS ._ files on external drives
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Contract);
}

async function check(shapes: ExtractedShape[], file: string, root: string): Promise<PreflightResponse> {
  const req = {
    agent: "claude-code" as const,
    developer: process.env.THECHAIR_DEVELOPER ?? "unknown",
    intent: `edit ${file}`,
    paths: [file],
    shapes,
  };
  const api = process.env.THECHAIR_API_URL;
  if (api) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const res = await fetch(`${api}/api/preflight?source=hook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.THECHAIR_AGENT_TOKEN ? { "x-thechair-agent-token": process.env.THECHAIR_AGENT_TOKEN } : {}),
        },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) return (await res.json()) as PreflightResponse;
    } catch {
      /* fall through to local check */
    }
  }
  return preflight(req, localContracts(root), [], "hook");
}

async function main() {
  const raw = readFileSync(0, "utf8");
  const input = JSON.parse(raw) as HookInput;
  const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const fp = input.tool_input.file_path;
  if (!fp) process.exit(0);
  const abs = isAbsolute(fp) ? fp : join(root, fp);
  const file = relative(root, abs);
  // Same skips as the webhook: test fixtures are full of API-looking strings.
  if (/^(contracts|node_modules|\.next)\/|\.test\./.test(file)) process.exit(0);

  const content = proposedContent(input, abs);
  if (content === undefined) process.exit(0);
  const shapes = extractDeterministic(file, content);
  if (shapes.length === 0) process.exit(0);

  const r = await check(shapes, file, root);
  if (r.verdict === "block") {
    const msg = [
      "theChair blocked this edit: it contradicts the team's API contract.",
      ...r.conflicts.filter((c) => c.severity === "block").map((c) => `- ${c.summary}`),
      r.suggestion ? `\nFix:\n${r.suggestion}` : "",
      "\nApply the fix and retry, or call propose_contract_change if the contract itself should change.",
    ].join("\n");
    process.stderr.write(msg + "\n");
    process.exit(2);
  }
  if (r.verdict === "warn") {
    process.stderr.write(`theChair warning: ${r.conflicts.map((c) => c.summary).join(" ")}\n`);
  }
  process.exit(0);
}

main().catch((e) => {
  // Never break the developer's session because theChair failed.
  process.stderr.write(`theChair hook error (edit allowed): ${(e as Error).message}\n`);
  process.exit(0);
});
