// Wire protocol between the Rust worker and this harness.
//
// IN  (stdin) : one JSON object per line — a TaskInput. MVP reads the first line.
// OUT (stdout): one JSON object per line — a HarnessEvent. The worker's
//               spawn_log_reader() streams these into agent-runs/{runId}.log and
//               re-emits them on the /events bus as `agent-log-appended` frames.
//
// stderr is reserved for raw diagnostics (never structured events).

export type TaskInput = {
  /** The user task / instruction. */
  prompt: string
  /** Working directory the filesystem tools operate in. Defaults to process.cwd(). */
  cwd?: string
  /** Correlation id echoed back on the `ready` event. */
  runId?: string
  /** Optional model hint. The hub runs the fallback cascade and may override it. */
  model?: string
}

export type HarnessEvent =
  | { type: "ready"; version: string; runId?: string }
  | { type: "token"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; id: string; name: string; result: unknown }
  | { type: "final"; content: string }
  | { type: "error"; message: string }

/** Emit one structured event as a JSON line on stdout. */
export function emit(ev: HarnessEvent): void {
  process.stdout.write(JSON.stringify(ev) + "\n")
}
