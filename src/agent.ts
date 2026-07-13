import { createDeepAgent, FilesystemBackend } from "deepagents"
import { ChatOpenAI } from "@langchain/openai"

/**
 * Build the deepagents ReactAgent.
 *
 * The single LLM endpoint is the Myra hub, which is OpenAI-compatible
 * (`POST /v1/chat/completions`). The hub injects the real OpenRouter key, runs
 * the model fallback cascade, and enforces per-user quota — so this process
 * holds no secret and knows only one URL.
 *
 * Env:
 *   MYRA_HUB_URL    base URL of the hub (baseURL = `${MYRA_HUB_URL}/v1`)
 *   MYRA_CREDENTIAL the Myra instance credential, passed as the OpenAI apiKey
 *   MYRA_MODEL      optional model hint (the hub may override via its cascade)
 */
export function buildAgent(opts: { cwd: string; model?: string }) {
  const hubUrl = (process.env.MYRA_HUB_URL ?? "https://openrouter.ai/api").replace(/\/+$/, "")
  const apiKey = process.env.MYRA_CREDENTIAL ?? process.env.OPENROUTER_API_KEY ?? "sk-dummy"

  return createDeepAgent({
    model: new ChatOpenAI({
      // "auto" is a sentinel: the hub's cascade picks the real model.
      model: opts.model ?? process.env.MYRA_MODEL ?? "auto",
      apiKey,
      streaming: true,
      configuration: { baseURL: `${hubUrl}/v1` },
    }),
    // Jail the agent to the card's working directory: `virtualMode` treats the
    // cwd as the virtual root `/`, so the agent sees ONLY this folder (and can't
    // escape via absolute paths or `..`/`~`). Without it deepagents' default
    // passes absolute paths straight to the real filesystem — the agent could
    // read all of $HOME and never knew which folder it was "in".
    // Worktree isolation is off by default — usecases are not always git repos.
    backend: new FilesystemBackend({ rootDir: opts.cwd, virtualMode: true }),
  })
}
