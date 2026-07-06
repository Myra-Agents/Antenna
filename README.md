# @myra/harness

Myra Agents' **embedded agent harness** — a [deepagents](https://github.com/langchain-ai/deepagentsjs)
ReactAgent (fs tools, planning, sub-tasks), bun-compiled to a standalone binary
and embedded in the Rust worker (`include_bytes!`). Zero install, zero API key
for the user.

Its single LLM endpoint is the **Myra hub** — an OpenAI-compatible proxy that
holds the shared OpenRouter key, runs the model fallback cascade, and enforces
per-user quota. The harness knows only one URL.

```
worker ──spawn──► myra-harness ──HTTP /v1/chat/completions──► hub ──► OpenRouter
        stdin: {prompt,cwd,runId}     stdout: JSON-lines events
```

## Protocol

**Input** (stdin, one JSON line):

```json
{ "prompt": "List files then write a haiku", "cwd": "/work", "runId": "r_123" }
```

**Output** (stdout, JSON-lines) — see [`src/protocol.ts`](src/protocol.ts):

| `type`        | payload                          |
|---------------|----------------------------------|
| `ready`       | `{version, runId?}`              |
| `token`       | `{text}` — streamed assistant text |
| `tool_call`   | `{id, name, args}`               |
| `tool_result` | `{id, name, result}`             |
| `final`       | `{content}`                      |
| `error`       | `{message}`                      |

## Env

| var              | meaning                                             |
|------------------|-----------------------------------------------------|
| `MYRA_HUB_URL`   | hub base URL; requests go to `${MYRA_HUB_URL}/v1`   |
| `MYRA_CREDENTIAL`| Myra instance credential (sent as the OpenAI apiKey)|
| `MYRA_MODEL`     | optional model hint (hub cascade may override)      |

## Develop

```sh
bun install
bun run smoke                       # no network: compile graph, print nodes
echo '{"prompt":"hi"}' | MYRA_HUB_URL=http://localhost:8787 \
  MYRA_CREDENTIAL=... bun run dev   # real run against a local hub
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
