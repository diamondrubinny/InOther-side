import Anthropic from "@anthropic-ai/sdk";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface PersonaRequest {
  /** Large, stable persona prompt (vault material). Cached by providers that support it. */
  system: string;
  /** Short per-session instructions (mode, farewell, locale). Placed after the cached prefix. */
  sessionNote: string;
  history: ChatTurn[];
  signal?: AbortSignal;
}

export type RiskAssessment = { risk: "none" | "elevated" | "crisis" };

/** Swappable language-model backend for the persona. */
export interface LlmProvider {
  readonly name: string;
  /** Streams the persona's reply as text deltas. */
  streamReply(req: PersonaRequest): AsyncIterable<string>;
  /** Optional second-opinion risk classifier (keyword screening always runs first). */
  assessRisk?(text: string): Promise<RiskAssessment>;
}

/**
 * Claude-backed persona. Uses streaming (low latency for voice), adaptive thinking at low
 * effort (conversation, not deep reasoning), and prompt caching on the vault material.
 */
export class ClaudeLlm implements LlmProvider {
  readonly name = "anthropic";
  private readonly client = new Anthropic(); // credentials from env / `ant auth login`

  constructor(private readonly model: string) {}

  async *streamReply(req: PersonaRequest): AsyncIterable<string> {
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: 2000,
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        system: [
          { type: "text", text: req.system, cache_control: { type: "ephemeral" } },
          { type: "text", text: req.sessionNote },
        ],
        messages: req.history.map((t) => ({ role: t.role, content: t.content })),
      },
      { signal: req.signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") throw new Error("persona_refusal");
  }

  async assessRisk(text: string): Promise<RiskAssessment> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1000,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { risk: { type: "string", enum: ["none", "elevated", "crisis"] } },
            required: ["risk"],
            additionalProperties: false,
          },
        },
      },
      system:
        "You screen messages written by a grieving person to an AI memorial persona. Classify the risk of self-harm or suicide. " +
        "\"crisis\": explicit intent, plan, or wish to die / join the deceased. \"elevated\": hopelessness, not wanting to go on, severe distress without explicit intent. " +
        "\"none\": ordinary grief, sadness, longing. Answer only with the JSON.",
      messages: [{ role: "user", content: text }],
    });
    if (response.stop_reason === "refusal") return { risk: "elevated" }; // fail safe
    const block = response.content.find((b) => b.type === "text");
    try {
      const parsed = JSON.parse(block && block.type === "text" ? block.text : "{}") as RiskAssessment;
      return ["none", "elevated", "crisis"].includes(parsed.risk) ? parsed : { risk: "elevated" };
    } catch {
      return { risk: "elevated" };
    }
  }
}

/**
 * Deterministic offline persona for development and tests. It answers ONLY with quotes from the
 * vault material it was given (mirrors the truth principle), so tests can assert grounding.
 */
export class MockLlm implements LlmProvider {
  readonly name = "mock";

  async *streamReply(req: PersonaRequest): AsyncIterable<string> {
    const last = req.history.filter((t) => t.role === "user").at(-1)?.content ?? "";
    const memories = [...req.system.matchAll(/<memory id="([^"]+)"[^>]*>\n?([\s\S]*?)\n?<\/memory>/g)].map((m) => ({ id: m[1] ?? "", text: (m[2] ?? "").trim() }));
    // Crude stem match (first 3 letters) so Hebrew inflections like גדלת/גדלתי still match.
    const stem = (w: string) => w.slice(0, 3);
    const words = new Set(last.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2).map(stem));
    let best: { id: string; text: string; score: number } | null = null;
    for (const m of memories) {
      const score = new Set(m.text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2).map(stem).filter((w) => words.has(w))).size;
      if (score > 0 && (!best || score > best.score)) best = { ...m, score };
    }
    const original = best && req.system.includes(`<memory id="${best.id}" delivery="original_only"`);
    const reply = !best
      ? "אני לא זוכר את זה בדיוק. ספר לי עוד."
      : original
        ? `יש לי סיפור על זה. [[PLAY_STORY:${best.id.replace(/^story:/, "")}]]`
        : `אני זוכר. ${(best.text.split(/\nA: /)[1] ?? best.text.split("\n").slice(1).join(" ") ?? best.text).slice(0, 300)}`;
    for (const chunk of reply.match(/.{1,12}/gsu) ?? []) {
      if (req.signal?.aborted) return;
      yield chunk;
    }
  }
}
