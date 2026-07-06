# harness — Claude Code Instructions

`@myra/harness`: the **embedded agent harness** for the Myra desktop app. A
[deepagents](https://github.com/langchain-ai/deepagentsjs) ReactAgent
bun-compiled to a standalone binary, embedded in the Rust worker via
`include_bytes!` and spawned per run. Zero install / zero API key for the user.

## Shape

- `src/agent.ts` — `buildAgent()`: `createDeepAgent({model, backend})`.
  `ChatOpenAI` points `baseURL` at **the hub** (`${MYRA_HUB_URL}/v1`), never
  OpenRouter directly. `FilesystemBackend` rootDir = the task cwd (worktree
  isolation off by default — usecases aren't always git repos).
- `src/protocol.ts` — the worker↔harness wire types. stdin = one JSON `TaskInput`
  line; stdout = JSON-lines `HarnessEvent`s. **stderr is raw diagnostics only** —
  never write structured events there.
- `src/index.ts` — CLI. `smoke` = no-network graph compile; default = read task,
  `streamEvents({version:"v2"})`, map LangGraph events → harness events.

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
bun run smoke        # expects a `final` event: "graph ok: ..."
```
