# harness — Agent Instructions

`@myra/harness`: the **embedded agent harness** for the Myra desktop app. A
[deepagents](https://github.com/langchain-ai/deepagentsjs) ReactAgent
bun-compiled to a standalone binary, embedded in the Rust worker via
`include_bytes!` and spawned per run. Zero install / zero API key for the user.

## Shape

- `src/agent.ts` — `buildAgent()`: `createDeepAgent({model, backend})`.
  `ChatOpenAI` points `baseURL` at **the hub** (`${MYRA_HUB_URL}/v1`), never
  OpenRouter directly. `FilesystemBackend` rootDir = the task cwd (worktree
  isolation off by default — usecases aren't always git repos).
- `src/protocol.ts` — the worker↔harness wire contract, a **vendored copy** of
  `@myra/shared/src/harness.ts` (`HarnessEvent`/`HarnessControl` + the
  `{runId,cardId,seq}` envelope) plus the deepagents→Myra tool-name rename map.
  Keep it byte-compatible with shared.
- `src/sink.ts` — where events go. `WsSink` dials the worker over a **loopback
  WebSocket** (`MYRA_WORKER_EVENT_URL`, `Authorization: Bearer <run-token>` via
  Bun's header extension), stamps the envelope + monotonic `seq`, and carries an
  inbound control channel (cancel). `StdoutSink` (JSON-lines) is the fallback
  when no worker URL is set — for isolated testing. **stderr is raw diagnostics
  only** — never structured events.
- `src/index.ts` — CLI. `smoke` = no-network graph compile; default = read the
  prompt from `argv[2]`, `streamEvents({version:"v2", signal})`, map LangGraph
  events → `HarnessEvent`s (buffered text, renamed tools, `write_todos`→`todos`
  widget), emit a terminal `result`. Cancel aborts the stream.

## Where the LLM logic lives

- **Fallback cascade + quota + shared key: the hub, not here.** This binary sends
  `model:"auto"` and one credential; the hub picks the real free model, retries
  on 429, and meters the user. Keep it that way — the cascade must stay
  patchable server-side without an app release.

## Gotchas

- **Use `getGraphAsync()`, not `getGraph()`** (POC-confirmed).
- **`streamEvents` v2** event names: `on_chat_model_stream` (token deltas),
  `on_chat_model_end` (final assistant text), `on_tool_start` / `on_tool_end`.
- **Bun compat is version-locked.** deepagents drags LangGraph/LangChain; a bad
  bump can break `bun build --compile`. `deepagents` + `@langchain/openai` are
  pinned exact — run `bun run smoke` after any bump before releasing.

## Verify

```sh
bun install
bun run typecheck
bun run smoke        # expects a `smoke` event with the compiled graph nodes
bun run compile      # bun --compile → dist/myra-harness (single binary, ~62MB)
```
