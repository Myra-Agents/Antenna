// Event sink: where HarnessEvents go and where HarnessControls come from.
//
// Two implementations:
//   - WsSink       : dials the worker over a loopback WebSocket (the real path).
//   - StdoutSink   : JSON-lines on stdout, no control channel (isolated testing
//                    with a real hub key but no worker, per README "Develop").
//
// Both stamp the {runId, cardId, seq} envelope so the caller only supplies the
// event body. `seq` is monotonic per process (one process = one run).

import type { HarnessControl, HarnessEvent, HarnessEventBody } from "./protocol"

export interface Sink {
  /** Stamp the envelope + seq onto a body and deliver it. */
  emit(body: HarnessEventBody): void | Promise<void>
  /** Register a handler for inbound control frames (WS only; no-op otherwise). */
  onControl(handler: (c: HarnessControl) => void): void
  /** Flush + close the transport. */
  close(): Promise<void>
}

interface Envelope {
  runId: string
  cardId: string
}

abstract class BaseSink implements Sink {
  private seq = 0
  private controlHandler: ((c: HarnessControl) => void) | null = null

  constructor(protected env: Envelope) {}

  emit(body: HarnessEventBody): void | Promise<void> {
    const ev: HarnessEvent = { runId: this.env.runId, cardId: this.env.cardId, seq: this.seq++, ...body }
    return this.deliver(ev)
  }

  onControl(handler: (c: HarnessControl) => void): void {
    this.controlHandler = handler
  }

  protected dispatchControl(raw: string): void {
    if (!this.controlHandler) return
    try {
      this.controlHandler(JSON.parse(raw) as HarnessControl)
    } catch (e) {
      process.stderr.write(`[harness] bad control frame: ${String(e)}\n`)
    }
  }

  protected abstract deliver(ev: HarnessEvent): void | Promise<void>
  abstract close(): Promise<void>
}

/** JSON-lines on stdout. No inbound control channel. */
export class StdoutSink extends BaseSink {
  protected deliver(ev: HarnessEvent): void {
    process.stdout.write(JSON.stringify(ev) + "\n")
  }
  async close(): Promise<void> {}
}

/**
 * Loopback WebSocket to the worker. Uses Bun's `WebSocket` header extension to
 * send `Authorization: Bearer <run-token>` on the handshake (a real header, not
 * a query param that would leak into logs).
 */
export class WsSink extends BaseSink {
  private ws: WebSocket
  private ready: Promise<void>

  constructor(url: string, token: string, env: Envelope) {
    super(env)
    // Bun extends the WHATWG WebSocket ctor with a `headers` option.
    this.ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } } as unknown as string[])
    this.ready = new Promise<void>((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve(), { once: true })
      this.ws.addEventListener("error", (e) => reject(new Error(`worker WS error: ${String((e as ErrorEvent).message ?? e)}`)), {
        once: true,
      })
    })
    this.ws.addEventListener("message", (m) => this.dispatchControl(String((m as MessageEvent).data)))
  }

  /** Await the handshake before emitting the first event. */
  connected(): Promise<void> {
    return this.ready
  }

  protected async deliver(ev: HarnessEvent): Promise<void> {
    await this.ready
    this.ws.send(JSON.stringify(ev))
  }

  async close(): Promise<void> {
    // Let the last frames drain, then close cleanly.
    await new Promise((r) => setTimeout(r, 50))
    try {
      this.ws.close(1000)
    } catch {
      /* already closed */
    }
  }
}

/** Build the sink from the environment: WS when the worker URL is set, else stdout. */
export function makeSink(): { sink: Sink; connected: Promise<void> } {
  const url = process.env.MYRA_WORKER_EVENT_URL
  const token = process.env.MYRA_RUN_TOKEN
  const env: Envelope = {
    runId: process.env.MYRA_RUN_ID ?? "r_local",
    cardId: process.env.MYRA_CARD_ID ?? "c_local",
  }
  if (url && token) {
    const sink = new WsSink(url, token, env)
    return { sink, connected: sink.connected() }
  }
  process.stderr.write("[harness] no MYRA_WORKER_EVENT_URL — falling back to stdout JSON-lines\n")
  return { sink: new StdoutSink(env), connected: Promise.resolve() }
}
