import { buildAgent } from "./agent"
import { emit, type TaskInput } from "./protocol"

const VERSION = "0.1.0"

/** Read the first JSON line off stdin and parse it as a TaskInput. */
async function readTask(): Promise<TaskInput> {
  const decoder = new TextDecoder()
  let buf = ""
  for await (const chunk of process.stdin) {
    buf += decoder.decode(chunk as Uint8Array)
    const nl = buf.indexOf("\n")
    if (nl >= 0) {
      buf = buf.slice(0, nl)
      break
    }
  }
  buf = buf.trim()
  if (!buf) throw new Error("empty task on stdin")
  return JSON.parse(buf) as TaskInput
}

/** Coerce a LangChain message content (string | parts[]) to plain text. */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : typeof (p as { text?: string }).text === "string" ? (p as { text: string }).text : ""))
      .join("")
  }
  return ""
}

async function runTask(task: TaskInput): Promise<void> {
  const cwd = task.cwd ?? process.cwd()
  const agent = buildAgent({ cwd, model: task.model })
  emit({ type: "ready", version: VERSION, runId: task.runId })

  let final = ""
  let acc = ""

  const stream = agent.streamEvents(
    { messages: [{ role: "user", content: task.prompt }] },
    { version: "v2" },
  )

  for await (const ev of stream as AsyncIterable<Record<string, any>>) {
    switch (ev.event) {
      case "on_chat_model_stream": {
        const text = contentToText(ev.data?.chunk?.content)
        if (text) {
          acc += text
          emit({ type: "token", text })
        }
        break
      }
      case "on_chat_model_end": {
        const text = contentToText(ev.data?.output?.content)
        if (text.trim()) final = text
        break
      }
      case "on_tool_start":
        emit({ type: "tool_call", id: String(ev.run_id ?? ""), name: String(ev.name ?? "tool"), args: ev.data?.input })
        break
      case "on_tool_end":
        emit({ type: "tool_result", id: String(ev.run_id ?? ""), name: String(ev.name ?? "tool"), result: ev.data?.output })
        break
    }
  }

  emit({ type: "final", content: final || acc })
}

async function main(): Promise<void> {
  const cmd = process.argv[2]

  // No-network smoke: compile the agent graph and report its nodes.
  if (cmd === "smoke") {
    const agent = buildAgent({ cwd: process.cwd() })
    const graph = (await agent.getGraphAsync()) as { nodes: Record<string, unknown> }
    emit({ type: "ready", version: VERSION })
    emit({ type: "final", content: `graph ok: ${Object.keys(graph.nodes).join(",")}` })
    return
  }

  const task = await readTask()
  await runTask(task)
}

main().catch((e) => {
  emit({ type: "error", message: e?.message ?? String(e) })
  process.exit(1)
})
