export type AIProvider = "anthropic" | "openai" | "groq";

interface AIClient {
  generateSummary(prompt: string): Promise<string>;
}

function getProvider(): AIProvider {
  const raw = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
  if (raw !== "anthropic" && raw !== "openai" && raw !== "groq") {
    throw new Error(
      `Invalid AI_PROVIDER "${raw}". Must be one of: anthropic, openai, groq.`
    );
  }
  return raw;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

async function createClient(provider: AIProvider): Promise<AIClient> {
  switch (provider) {
    case "anthropic": {
      const apiKey = requireEnv("ANTHROPIC_API_KEY");
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });
      const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
      return {
        async generateSummary(prompt) {
          const res = await client.messages.create({
            model,
            max_tokens: 600,
            messages: [{ role: "user", content: prompt }],
          });
          return res.content
            .filter((b) => b.type === "text")
            .map((b) => ("text" in b ? b.text : ""))
            .join("\n")
            .trim();
        },
      };
    }
    case "openai": {
      const apiKey = requireEnv("OPENAI_API_KEY");
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey });
      const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
      return {
        async generateSummary(prompt) {
          const res = await client.chat.completions.create({
            model,
            max_completion_tokens: 600,
            messages: [{ role: "user", content: prompt }],
          });
          return res.choices[0]?.message?.content?.trim() || "";
        },
      };
    }
    case "groq": {
      const apiKey = requireEnv("GROQ_API_KEY");
      const { default: Groq } = await import("groq-sdk");
      const client = new Groq({ apiKey });
      const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
      return {
        async generateSummary(prompt) {
          const res = await client.chat.completions.create({
            model,
            max_tokens: 600,
            messages: [{ role: "user", content: prompt }],
          });
          return res.choices[0]?.message?.content?.trim() || "";
        },
      };
    }
  }
}

export async function generateSummary(prompt: string): Promise<string> {
  const provider = getProvider();
  const client = await createClient(provider);
  return client.generateSummary(prompt);
}
