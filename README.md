# @myra/harness

Myra Agents' **embedded agent harness** — a [deepagents](https://github.com/langchain-ai/deepagentsjs)
ReactAgent (fs tools, planning, sub-tasks), bun-compiled to a standalone binary
and embedded in the Rust worker (`include_bytes!`). Zero install, zero API key
for the user.

Its single LLM endpoint is the **Myra hub** — an OpenAI-compatible proxy that
holds the shared OpenRouter key, runs the model fallback cascade, and enforces
per-user quota. The harness knows only one URL.

```
                    prompt (argv)                    Authorization: Bearer <token>
worker ──spawn──► myra-harness ──────► hub ──► OpenRouter
   ▲  loopback WebSocket (/agent-events) │
   └──────── HarnessEvent (up) ──────────┘
            HarnessControl (down: cancel/resume/approve)
```

The worker mints a per-run token, spawns the binary with the prompt as `argv[2]`
and the env below, and the harness dials back over a loopback WebSocket. Events
flow up (persisted + re-emitted by the worker); controls flow down.

## Protocol

The wire contract is a vendored copy of `@myra/shared`'s `harness.ts` — see
[`src/protocol.ts`](src/protocol.ts). Every event carries a `{runId, cardId,
seq}` envelope (`seq` = monotonic per run, for catch-up on reconnect).

**harness → worker** (`HarnessEvent`):

| `type`        | payload                                            |
|---------------|----------------------------------------------------|
| `text`        | `{text}` — assistant prose (buffered per turn)     |
| `thinking`    | `{text}` — reasoning                               |
| `tool_use`    | `{id, name, input}` — name renamed to Myra's keys  |
| `tool_result` | `{toolUseId, content, isError}`                    |
| `todos`       | `{todos[]}` — `write_todos` → checklist widget     |
| `result`      | `{status, summary?, question?, error?, tokens?, cost?}` |

**worker → harness** (`HarnessControl`): `cancel` (wired), `resume` / `approve`
(reserved for async-feedback + safety-gate).

The harness embedded here **does not** write `agent-results/{cardId}.json` — the
worker applies the card transition straight from the `result` event.

## Env

| var                    | meaning                                                    |
|------------------------|------------------------------------------------------------|
| `MYRA_WORKER_EVENT_URL`| worker WS URL, e.g. `ws://127.0.0.1:4319/agent-events`. Absent → stdout JSON-lines fallback |
| `MYRA_RUN_TOKEN`       | per-run bearer token for the WS handshake                  |
| `MYRA_RUN_ID`          | run id, stamped on the envelope                            |
| `MYRA_CARD_ID`         | card id, stamped on the envelope                           |
| `MYRA_HUB_URL`         | hub base URL; requests go to `${MYRA_HUB_URL}/v1`          |
| `MYRA_CREDENTIAL`      | Myra instance credential (sent as the OpenAI apiKey)       |
| `MYRA_MODEL`           | optional model hint (hub cascade may override)             |

## Develop

```sh
bun install
bun run smoke                       # no network: compile graph, print nodes
# real run against a local hub, stdout fallback (no worker):
MYRA_HUB_URL=http://localhost:8787 MYRA_CREDENTIAL=... bun run dev "list files then write a haiku"
bun run typecheck
```

## Build

CI (`.github/workflows/release.yml`) runs `bun build --compile` for
darwin-arm64/x64, linux-x64, windows-x64 on tag `v*`, names each binary with its
Rust target triple, and publishes a `harness-vX.Y.Z` release consumed by the
worker's build step.

## Deps — pin strict

deepagents rides the LangGraph/LangChain stack; Bun compat is verified per
version. `deepagents` and `@langchain/openai` are pinned exact — re-verify the
smoke build before bumping either.
