// Wire contract between this harness and the Rust worker, carried over a
// loopback WebSocket (worker route `GET /agent-events`). This REPLACES the POC
// stdout JSON-lines protocol.
//
// These types are a vendored copy of `@myra/shared/src/harness.ts` — the harness
// is a standalone bun-compiled binary and does not pull the shared submodule, so
// the shape is duplicated here and MUST stay byte-compatible with shared.
//
// Direction:
//   harness → worker : HarnessEvent   (transcript stream + terminal result)
//   worker  → harness : HarnessControl (cancel / resume / approve)
//
// stderr stays raw diagnostics only — never write structured events there.

/** Correlation + ordering envelope on every harness → worker event. */
export interface HarnessEnvelope {
  runId: string
  cardId: string
  /** Monotonic per-run sequence number (0-based), assigned by the harness. */
  seq: number
}

export interface HarnessTodo {
  content: string
  status: "pending" | "in_progress" | "completed"
}

export type HarnessResultStatus = "awaiting_review" | "waiting_feedback" | "failed"

/** The body of a harness → worker event, before the envelope is stamped on. */
export type HarnessEventBody =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
  | { type: "todos"; todos: HarnessTodo[] }
  | {
      type: "result"
      status: HarnessResultStatus
      summary?: string
      question?: string
      error?: string
      tokens?: number
      cost?: number
    }

export type HarnessEvent = HarnessEnvelope & HarnessEventBody

/** worker → harness control frames over the same socket. */
export type HarnessControl =
  | { type: "cancel" }
  | { type: "resume"; input: string }
  | { type: "approve"; toolUseId: string; approved: boolean }

// ─────────────────────── deepagents tool-name mapping ───────────────────────
//
// Rename deepagents' built-in tool names to Myra's icon keys so the app renderer
// shows a first-class header + icon with zero per-agent knowledge. The renderer
// lowercases the name for icon lookup (read → FileSearch, bash → Terminal, …),
// so the capitalized Claude-style names below both read well and resolve icons.

const TOOL_RENAME: Record<string, string> = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  ls: "List",
  glob: "Glob",
  grep: "Grep",
  execute: "Bash",
  write_todos: "TodoWrite",
  task: "Task",
}

/** Map a raw deepagents tool name to its Myra display/icon name. */
export function renameTool(name: string): string {
  return TOOL_RENAME[name] ?? name
}

/** True for the planning tool whose calls surface as a `todos` event/widget. */
export function isTodoTool(name: string): boolean {
  return name === "write_todos"
}
