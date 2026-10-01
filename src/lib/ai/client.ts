/**
 * The one door to the language model.
 *
 *   generate(task, schema, { prompt, vars, data, images })
 *
 * - Real mode (ANTHROPIC_API_KEY): renders prompts/<prompt>.md, sends images + text, forces a
 *   single "submit" tool whose input_schema is the zod schema (so output is JSON by construction),
 *   validates with zod and retries ONCE with the validation errors fed back as a tool_result.
 * - Demo mode (no key, or AI_PROVIDER=mock): routes to the deterministic mock provider with the
 *   same schema validation, so both paths produce identical shapes.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env, isDemoAI } from "@/lib/config";
import type { AiImage } from "./images";
import { runMock } from "./mock";
import { renderPrompt } from "./prompts";
import type { AiTask, AiTaskData } from "./tasks";

export type { AiTask, AiTaskData } from "./tasks";

export type GenerateInput<K extends AiTask> = {
  /** Prompt file name under prompts/ (without .md). */
  prompt: string;
  vars: Record<string, string | number>;
  /** Structured task data; the mock provider writes from this. */
  data: AiTaskData[K];
  images?: AiImage[];
  maxTokens?: number;
  timeoutMs?: number;
};

export type GenerateResult<T> = {
  data: T;
  provider: "anthropic" | "mock";
  model: string;
  prompt: string;
  promptVersion: number;
  attempts: number;
};

export class AiOutputError extends Error {
  constructor(message: string, readonly issues: string[]) {
    super(message);
  }
}

/** AI_PROVIDER=mock|anthropic overrides the key-based default (evals, tests). */
export const usingMockAI = (): boolean =>
  process.env.AI_PROVIDER === "mock" ? true : process.env.AI_PROVIDER === "anthropic" ? false : isDemoAI();

type MessagesApi = Pick<Anthropic, "messages">;
let client: MessagesApi | null = null;
function anthropic(): MessagesApi {
  if (!client) client = new Anthropic({ apiKey: env.anthropicKey ?? undefined, maxRetries: 2, timeout: 120_000 });
  return client;
}

/** Dependency injection seam (tests, or a proxy/gateway client). */
export function setAnthropicClient(c: MessagesApi | null): void {
  client = c;
}

export function formatIssues(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

/** zod -> JSON Schema for tool input (input side, so defaulted fields are optional). */
export function toolSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

export async function generate<K extends AiTask, T>(
  task: K,
  schema: z.ZodType<T>,
  input: GenerateInput<K>,
): Promise<GenerateResult<T>> {
  const rendered = renderPrompt(input.prompt, input.vars);
  const meta = { prompt: input.prompt, promptVersion: rendered.version };

  if (usingMockAI()) {
    const res = schema.safeParse(runMock(task, input.data));
    if (!res.success) throw new AiOutputError(`Mock output for "${task}" failed validation`, formatIssues(res.error));
    return { data: res.data, provider: "mock", model: "demo-mock", attempts: 1, ...meta };
  }

  const system = renderPrompt("system", {}).text;
  const tool: Anthropic.Tool = {
    name: "submit",
    description: `Submit the ${task.replace(/_/g, " ")} as structured JSON.`,
    input_schema: toolSchema(schema) as Anthropic.Tool.InputSchema,
  };
  const content: Anthropic.ContentBlockParam[] = [];
  for (const img of input.images ?? []) {
    content.push({ type: "text", text: `Image mediaId=${img.mediaId} stage=${img.stage}` });
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
  }
  content.push({ type: "text", text: rendered.text });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content }];

  let lastIssues: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await anthropic().messages.create(
      {
        model: env.anthropicModel,
        max_tokens: input.maxTokens ?? 4096,
        system,
        messages,
        tools: [tool],
        tool_choice: { type: "tool", name: "submit" },
      },
      { timeout: input.timeoutMs ?? 90_000 },
    );
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!call) {
      lastIssues = ["model did not call the submit tool"];
      messages.push({ role: "assistant", content: res.content });
      messages.push({ role: "user", content: "Call the submit tool with the JSON output." });
      continue;
    }
    const parsed = schema.safeParse(call.input);
    if (parsed.success) return { data: parsed.data, provider: "anthropic", model: env.anthropicModel, attempts: attempt, ...meta };
    lastIssues = formatIssues(parsed.error);
    messages.push({ role: "assistant", content: res.content });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: call.id,
          is_error: true,
          content: `Validation failed. Fix these and call submit again with the complete object:\n- ${lastIssues.join("\n- ")}`,
        },
      ],
    });
  }
  throw new AiOutputError(`Model output for "${task}" failed validation twice`, lastIssues);
}
