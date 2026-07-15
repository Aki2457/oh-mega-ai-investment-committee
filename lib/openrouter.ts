import type { AnalystOpinion, Citation, FinalDecision, MarketPack, Profile, RiskOpinion } from "./types";
import Ajv from "ajv";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS ?? 25_000);
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new WeakMap<object, ReturnType<typeof ajv.compile>>();

export const profileModels = {
  flash: { quantitative: "openai/gpt-oss-20b:free", macro: null, risk: "openai/gpt-oss-20b:free", judge: "openai/gpt-oss-20b:free" },
  think: { quantitative: "openai/gpt-oss-20b:free", macro: "openai/gpt-oss-120b:free", risk: "openai/gpt-oss-20b:free", judge: "openai/gpt-oss-120b:free" },
  pro: { quantitative: "openai/gpt-oss-20b:free", macro: "openai/gpt-oss-120b:free", risk: "openai/gpt-oss-120b:free", judge: "openai/gpt-oss-120b:free" },
} as const;

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function citationSchema() {
  return {
    type: "object", additionalProperties: false,
    properties: { url: { type: "string" }, title: { type: "string" }, content: { type: "string" } },
    required: ["url", "title", "content"],
  };
}

function candidateSchema() {
  return {
    type: "object", additionalProperties: false,
    properties: {
      ticker: { type: "string" }, region: { type: "string", enum: ["US", "China/HK"] }, reason: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 }, citations: { type: "array", items: citationSchema() },
    }, required: ["ticker", "region", "reason", "confidence", "citations"],
  };
}

function stockViewSchema() {
  return {
    type: "object", additionalProperties: false,
    properties: {
      ticker: { type: "string" }, upProbability: { type: "number", minimum: 0, maximum: 1 },
      expectedReturnPct: { type: "number" }, catalystScore: { type: "number", minimum: 0, maximum: 1 },
    }, required: ["ticker", "upProbability", "expectedReturnPct", "catalystScore"],
  };
}

const analystSchema = {
  type: "object", additionalProperties: false,
  properties: {
    role: { type: "string" }, model: { type: "string" }, mode: { type: "string", enum: ["Balanced", "Attach", "Lockdown"] },
    usUpProbability: { type: "number", minimum: 0, maximum: 1 }, chinaUpProbability: { type: "number", minimum: 0, maximum: 1 },
    usExpectedReturnPct: { type: "number" }, chinaExpectedReturnPct: { type: "number" }, confidence: { type: "number", minimum: 0, maximum: 1 },
    catalysts: { type: "array", items: { type: "string" } }, risks: { type: "array", items: { type: "string" } }, rationale: { type: "string" },
    candidates: { type: "array", items: candidateSchema() }, stockViews: { type: "array", items: stockViewSchema() },
    citations: { type: "array", items: citationSchema() },
  },
  required: ["role", "model", "mode", "usUpProbability", "chinaUpProbability", "usExpectedReturnPct", "chinaExpectedReturnPct", "confidence", "catalysts", "risks", "rationale", "candidates", "stockViews", "citations"],
};

const riskSchema = {
  type: "object", additionalProperties: false,
  properties: {
    opinion: { type: "string", enum: ["Support", "Support with conditions", "Challenge"] }, confidence: { type: "number", minimum: 0, maximum: 1 },
    concerns: { type: "array", items: { type: "string" } }, conditions: { type: "array", items: { type: "string" } },
    improvementExperiments: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      objective: { type: "string" }, test: { type: "string" }, successMeasure: { type: "string" }, tradeoff: { type: "string" },
    }, required: ["objective", "test", "successMeasure", "tradeoff"] } },
    rationale: { type: "string" },
  }, required: ["opinion", "confidence", "concerns", "conditions", "improvementExperiments", "rationale"],
};

const scoreSchema = {
  type: "object", additionalProperties: false, properties: {
    role: { type: "string" }, evidenceQuality: { type: "number", minimum: 0, maximum: 100 }, dataConsistency: { type: "number", minimum: 0, maximum: 100 },
    calibration: { type: "number", minimum: 0, maximum: 100 }, sourceQuality: { type: "number", minimum: 0, maximum: 100 }, riskAwareness: { type: "number", minimum: 0, maximum: 100 }, total: { type: "number", minimum: 0, maximum: 100 },
  }, required: ["role", "evidenceQuality", "dataConsistency", "calibration", "sourceQuality", "riskAwareness", "total"],
};

const finalSchema = {
  type: "object", additionalProperties: false,
  properties: {
    mode: { type: "string", enum: ["Balanced", "Attach", "Lockdown"] }, confidence: { type: "number", minimum: 0, maximum: 1 },
    usUpProbability: { type: "number", minimum: 0, maximum: 1 }, chinaUpProbability: { type: "number", minimum: 0, maximum: 1 },
    usExpectedReturnPct: { type: "number" }, chinaExpectedReturnPct: { type: "number" },
    usSleevePct: { type: "number", minimum: 35, maximum: 65 }, chinaSleevePct: { type: "number", minimum: 35, maximum: 65 },
    rationale: { type: "string" }, riskOverrideRationale: { type: "string" }, analystScores: { type: "array", items: scoreSchema },
    candidates: { type: "array", items: candidateSchema() }, stockViews: { type: "array", items: stockViewSchema() }, citations: { type: "array", items: citationSchema() },
  }, required: ["mode", "confidence", "usUpProbability", "chinaUpProbability", "usExpectedReturnPct", "chinaExpectedReturnPct", "usSleevePct", "chinaSleevePct", "rationale", "riskOverrideRationale", "analystScores", "candidates", "stockViews", "citations"],
};

function openRouterKey() {
  return process.env.OPENROUTER_API_KEY?.trim() ?? "";
}

export function openRouterConfigured() {
  return Boolean(openRouterKey()) || process.env.OPENROUTER_MOCK === "1";
}

function normalizeCitations(items: Citation[]) {
  const unique = new Map<string, Citation>();
  for (const citation of items) if (citation.url) unique.set(citation.url, citation);
  return Array.from(unique.values());
}

function annotationsToCitations(annotations: unknown): Citation[] {
  if (!Array.isArray(annotations)) return [];
  return annotations.flatMap((annotation) => {
    const item = annotation as { type?: string; url_citation?: { url?: string; title?: string; content?: string } };
    if (item.type !== "url_citation" || !item.url_citation?.url) return [];
    return [{ url: item.url_citation.url, title: item.url_citation.title ?? item.url_citation.url, content: item.url_citation.content ?? "" }];
  });
}

async function requestOpenRouter(input: { model: string; messages: ChatMessage[]; schemaName?: string; schema?: object; webSearch?: boolean }) {
  if (process.env.OPENROUTER_MOCK === "1") return mockResponse(input.schemaName ?? "chat", input.model, input.messages.at(-1)?.content ?? "");
  const key = openRouterKey();
  if (!key) throw new Error("OPENROUTER_API_KEY is missing. Add it to .env.local and restart localhost.");
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    temperature: 0.2,
    max_tokens: 3000,
    reasoning: { effort: input.model.includes("120b") ? "high" : "medium", exclude: true },
    provider: { allow_fallbacks: true },
  };
  if (input.schema && input.schemaName) {
    body.response_format = { type: "json_schema", json_schema: { name: input.schemaName, strict: true, schema: input.schema } };
  }
  if (input.webSearch) body.tools = [{ type: "openrouter:web_search", engine: "auto", search_context_size: "high", max_total_results: 8 }];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OH_MEGA_BASE_URL ?? "http://localhost:8888",
        "X-Title": "OH MEGA AI Investment Committee",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`OpenRouter timed out after ${Math.round(OPENROUTER_TIMEOUT_MS / 1000)} seconds`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const payload = await response.json() as { error?: { message?: string }; choices?: Array<{ message?: { content?: string; annotations?: unknown } }> };
  if (!response.ok) throw new Error(payload.error?.message ?? `OpenRouter returned ${response.status}`);
  const message = payload.choices?.[0]?.message;
  if (!message?.content) throw new Error("OpenRouter returned an empty response");
  return { content: message.content, citations: annotationsToCitations(message.annotations) };
}

async function structured<T>(input: { model: string; messages: ChatMessage[]; schemaName: string; schema: object; webSearch?: boolean }): Promise<T> {
  const response = await requestOpenRouter(input);
  let parsed: T;
  try { parsed = JSON.parse(response.content) as T; } catch { throw new Error(`${input.schemaName} returned invalid JSON`); }
  let validate = validators.get(input.schema);
  if (!validate) {
    validate = ajv.compile(input.schema);
    validators.set(input.schema, validate);
  }
  if (!validate(parsed)) {
    const detail = ajv.errorsText(validate.errors, { separator: "; " });
    throw new Error(`${input.schemaName} failed schema validation: ${detail}`);
  }
  const object = parsed as Record<string, unknown>;
  if (Array.isArray(object.citations)) object.citations = normalizeCitations([...(object.citations as Citation[]), ...response.citations]);
  return parsed;
}

function sharedContext(pack: MarketPack) {
  return `Forecast horizon: next Friday close-to-close USD total return.\nMechanical trend mode: ${pack.mechanicalMode}.\nMarket data as of ${pack.dataAsOf}. Stale=${pack.stale}.\nApproved universe: ${JSON.stringify(pack.approvedTickers)}.\nQuantitative pack: ${JSON.stringify(pack.features)}.`;
}

export async function quantitativeOpinion(pack: MarketPack, profile: Profile): Promise<AnalystOpinion> {
  const model = profileModels[profile].quantitative;
  return structured({ model, schemaName: "quantitative_opinion", schema: analystSchema, messages: [
    { role: "system", content: "You are the quantitative member of the Decision Agent for a simulated US and China/HK AI technology fund. Use only supplied point-in-time price evidence. Estimate calibrated next-week probabilities and returns. Do not invent facts or sources. Recommend up to five candidates per region only when evidence supports them. Choose Balanced, Attach, or Lockdown. Attach means higher conviction with a 25 percent minimum cash reserve. Return the required JSON." },
    { role: "user", content: `${sharedContext(pack)}\nSet role to Decision Agent, Quantitative and model to ${model}.` },
  ] });
}

export async function macroOpinion(pack: MarketPack, profile: Profile): Promise<AnalystOpinion | null> {
  const model = profileModels[profile].macro;
  if (!model) return null;
  return structured({ model, schemaName: "macro_opinion", schema: analystSchema, webSearch: true, messages: [
    { role: "system", content: "You are the web research member of the Decision Agent for a simulated US and China/HK AI technology fund. Search the last seven days. Prioritize regulators, exchanges, filings, central banks, statistical agencies, and investor relations. Every current claim must have a URL citation. Estimate next-week probabilities and returns. Choose Balanced, Attach, or Lockdown. Return the required JSON." },
    { role: "user", content: `${sharedContext(pack)}\nSearch for current evidence affecting the listed markets and approved stocks. Set role to Decision Agent, Web Research and model to ${model}.` },
  ] });
}

export async function riskOpinion(pack: MarketPack, opinions: AnalystOpinion[], profile: Profile): Promise<RiskOpinion> {
  const model = profileModels[profile].risk;
  return structured({ model, schemaName: "risk_opinion", schema: riskSchema, messages: [
    { role: "system", content: "You are the independent Risk Agent. Challenge data freshness, disagreement, concentration, liquidity, volatility, drawdown, turnover, source quality, model risk, and false confidence. Review process quality as well as the predicted outcome. Return the required JSON with exactly three improvement experiments when possible." },
    { role: "user", content: `${sharedContext(pack)}\nAnalyst opinions: ${JSON.stringify(opinions)}` },
  ] });
}

export async function judgeDecision(pack: MarketPack, opinions: AnalystOpinion[], risk: RiskOpinion, profile: Profile): Promise<FinalDecision> {
  const model = profileModels[profile].judge;
  return structured({ model, schemaName: "final_decision", schema: finalSchema, messages: [
    { role: "system", content: "You are the CEO Agent and main judge for a simulated paper portfolio. You may choose Balanced, Attach, or Lockdown. Balanced targets 50 percent stocks and 50 percent cash. Attach is the higher-conviction mode and targets no more than 75 percent stocks, preserving at least 25 percent cash. Lockdown means 100 percent cash and is used for severe risk or unusable evidence. Score every analyst from 0 to 100 for evidence quality, data consistency, calibration, source quality, and risk awareness. Keep each regional stock-sleeve share between 35 and 65 and make them total 100. Treat Risk objections explicitly. Use approved stocks only for stockViews. Candidates remain pending. The Human makes the final authorization, so produce a recommendation only. Return the required JSON." },
    { role: "user", content: `${sharedContext(pack)}\nAnalyst opinions: ${JSON.stringify(opinions)}\nIndependent Risk opinion: ${JSON.stringify(risk)}\nThe portfolio is simulated and has no broker connection.` },
  ] });
}

export async function chatCompletion(input: { agent: string; profile: Profile; messages: ChatMessage[]; context: string }) {
  const model = input.profile === "flash" ? profileModels.flash.judge : input.profile === "think" ? profileModels.think.judge : profileModels.pro.judge;
  const system = `You are the OH MEGA ${input.agent} Agent for a simulated US and China/HK AI technology paper fund. Answer directly. Use supplied real market and portfolio data. Search the web when current evidence is relevant and cite every current claim. The only modes are Balanced, Attach, and Lockdown. Preserve at least 25 percent cash in every investable recommendation. Never claim to place trades or to have Human approval.\n${input.context}`;
  const response = await requestOpenRouter({ model, webSearch: true, messages: [{ role: "system", content: system }, ...input.messages] });
  return { text: response.content, citations: response.citations, model };
}

function mockResponse(schemaName: string, model: string, prompt: string) {
  const citation = { url: "https://example.com/mock-source", title: "Mock source", content: "Test-only source" };
  if (schemaName.includes("opinion") && schemaName !== "risk_opinion") return { content: JSON.stringify({
    role: schemaName.startsWith("macro") ? "Decision Agent, Web Research" : "Decision Agent, Quantitative", model, mode: "Balanced",
    usUpProbability: 0.58, chinaUpProbability: 0.46, usExpectedReturnPct: 0.7, chinaExpectedReturnPct: -0.2, confidence: 0.63,
    catalysts: ["Positive US trend"], risks: ["China trend remains weak"], rationale: "The evidence is mixed.", candidates: [], stockViews: [], citations: [citation],
  }), citations: [citation] };
  if (schemaName === "risk_opinion") return { content: JSON.stringify({ opinion: "Support with conditions", confidence: 0.7, concerns: ["Regional divergence"], conditions: ["Keep hard caps"], improvementExperiments: [
    { objective: "Improve Sharpe", test: "Compare mode engines", successMeasure: "Sharpe above 0.90", tradeoff: "Potential whipsaw" },
    { objective: "Reduce volatility", test: "Volatility-aware weights", successMeasure: "Volatility below 18%", tradeoff: "Lower upside" },
    { objective: "Improve calibration", test: "Track Brier score", successMeasure: "Falling error", tradeoff: "Longer evaluation period" },
  ], rationale: "Proceed with controls." }), citations: [] };
  if (schemaName === "final_decision") return { content: JSON.stringify({ mode: "Balanced", confidence: 0.68, usUpProbability: 0.58, chinaUpProbability: 0.46, usExpectedReturnPct: 0.7, chinaExpectedReturnPct: -0.2, usSleevePct: 65, chinaSleevePct: 35, rationale: "Mixed market evidence supports Balanced.", riskOverrideRationale: "No override required.", analystScores: [{ role: "Decision Agent, Quantitative", evidenceQuality: 80, dataConsistency: 80, calibration: 70, sourceQuality: 70, riskAwareness: 75, total: 75 }], candidates: [], stockViews: [], citations: [citation] }), citations: [citation] };
  return { content: `Mock ${model} response to: ${prompt.slice(0, 80)}`, citations: [citation] };
}
