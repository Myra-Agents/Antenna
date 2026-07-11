import { buildAgent } from "./agent"
import { isTodoTool, renameTool, type HarnessResultStatus, type HarnessTodo } from "./protocol"
import { makeSink, type Sink } from "./sink"

const VERSION = "0.2.0"

/** Coerce LangChain message content (string | parts[]) to plain text. */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        typeof p === "string" ? p : typeof (p as { text?: string }).text === "string" ? (p as { text: string }).text : "",
      )
      .join("")
  }
  return ""
}

/** Best-effort JSON/text rendering of a tool output for the transcript. */
function toolOutputToText(output: unknown): { content: string; isError: boolean } {
  // deepagents/LangChain hand back a ToolMessage-like object on `on_tool_end`.
  const msg = output as { content?: unknown; status?: string } | undefined
  const isError = msg?.status === "error"
  if (msg && "content" in msg) return { content: contentToText(msg.content) || stringify(msg.content), isError }
  return { content: stringify(output), isError }
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** Pull total token usage off a chat-model-end event, if present. */
function usageTokens(data: unknown): number | undefined {
  const out = (data as { output?: { usage_metadata?: { total_tokens?: number } } })?.output
  const t = out?.usage_metadata?.total_tokens
  return typeof t === "number" ? t : undefined
}

async function runTask(prompt: string, sink: Sink): Promise<void> {
  const cwd = process.cwd()
  const agent = buildAgent({ cwd })

  const controller = new AbortController()
  sink.onControl((c) => {
    if (c.type === "cancel") {
      process.stderr.write("[harness] cancel received\n")
      controller.abort()
    }
    // resume / approve: wired when async-feedback + safety-gate land.
  })

  let textBuf = ""
  let lastFinal = ""
  let tokens: number | undefined

  const flushText = async () => {
    const t = textBuf.trim()
    textBuf = ""
    if (t) await sink.emit({ type: "text", text: t })
  }

  const stream = agent.streamEvents(
    { messages: [{ role: "user", content: prompt }] },
    { version: "v2", signal: controller.signal },
  )

  try {
    for await (const ev of stream as AsyncIterable<Record<string, any>>) {
      switch (ev.event) {
        case "on_chat_model_stream": {
          textBuf += contentToText(ev.data?.chunk?.content)
          break
        }
        case "on_chat_model_end": {
          const text = contentToText(ev.data?.output?.content)
          if (text.trim()) lastFinal = text
          const t = usageTokens(ev.data)
          if (t) tokens = (tokens ?? 0) + t
          await flushText()
          break
        }
        case "on_tool_start": {
          await flushText()
          const raw = String(ev.name ?? "tool")
          const id = String(ev.run_id ?? "")
          const input = (ev.data?.input ?? {}) as Record<string, unknown>
          await sink.emit({ type: "tool_use", id, name: renameTool(raw), input })
          if (isTodoTool(raw)) {
            const todos = (input.todos as HarnessTodo[] | undefined) ?? []
            await sink.emit({ type: "todos", todos })
          }
          break
        }
        case "on_tool_end": {
          const id = String(ev.run_id ?? "")
          const { content, isError } = toolOutputToText(ev.data?.output)
          await sink.emit({ type: "tool_result", toolUseId: id, content, isError })
          break
        }
      }
    }
  } catch (e) {
    if (controller.signal.aborted) {
      await sink.emit({ type: "result", status: "failed", error: "canceled" })
      return
    }
    throw e
  }

  await flushText()
  const status: HarnessResultStatus = "awaiting_review"
  await sink.emit({ type: "result", status, summary: lastFinal || undefined, tokens })
}

async function main(): Promise<void> {
  const arg = process.argv[2]

  // No-network smoke: compile the agent graph and report its nodes on stdout.
  if (arg === "smoke") {
    const agent = buildAgent({ cwd: process.cwd() })
    const graph = (await agent.getGraphAsync()) as { nodes: Record<string, unknown> }
    process.stdout.write(JSON.stringify({ type: "smoke", version: VERSION, nodes: Object.keys(graph.nodes) }) + "\n")
    return
  }

  const prompt = arg
  if (!prompt) throw new Error("no prompt given (expected as argv[2])")

  const { sink, connected } = makeSink()
  await connected
  try {
    await runTask(prompt, sink)
  } catch (e) {
    process.stderr.write(`[harness] fatal: ${(e as Error)?.stack ?? String(e)}\n`)
    // Terminal result so the worker can transition the card to failed.
    await sink.emit({ type: "result", status: "failed", error: (e as Error)?.message ?? String(e) })
    await sink.close()
    process.exit(1)
  }
  await sink.close()
}

main().catch((e) => {
  process.stderr.write(`[harness] fatal (pre-connect): ${e?.stack ?? e?.message ?? String(e)}\n`)
  process.exit(1)
})
