// Identify which tool sent a request (for per-client analytics and limits),
// from the User-Agent and the few headers tools add. Unknown clients are
// grouped by their User-Agent product token.

export interface ClientId {
  id: string;
  name: string;
}

type Headers = Record<string, string | string[] | undefined>;

const h1 = (h: Headers, k: string) => {
  const v = h[k];
  return (Array.isArray(v) ? v[0] : v) || '';
};

// Order matters: the first match wins. Patterns run against the User-Agent,
// except those prefixed with a header name ("x-title:").
const RULES: Array<[RegExp, string, string, string?]> = [
  [/claude-cli|claude-code/i, 'claude-code', 'Claude Code'],
  [/codex_cli_rs|codex-cli|codex_exec|\bcodex\//i, 'codex', 'Codex CLI'],
  [/GeminiCLI|gemini-cli/i, 'gemini-cli', 'Gemini CLI'],
  [/qwen-code|QwenCode/i, 'qwen-code', 'Qwen Code'],
  [/\bopencode\b/i, 'opencode', 'OpenCode'],
  [/\bcrush\//i, 'crush', 'Crush'],
  [/\bkilo[-_ ]?code|kilocode/i, 'kilo-code', 'Kilo Code'],
  [/roo[-_ ]?code|roo-cline/i, 'roo-code', 'Roo Code'],
  [/\bcline\b/i, 'cline', 'Cline'],
  [/continue/i, 'continue', 'Continue'],
  [/\bcursor\b/i, 'cursor', 'Cursor'],
  [/windsurf|codeium/i, 'windsurf', 'Windsurf'],
  [/\bzed\b/i, 'zed', 'Zed'],
  [/GitHubCopilotChat|copilot/i, 'copilot', 'GitHub Copilot'],
  [/JetBrains|IntelliJ|PyCharm|WebStorm|GoLand|Rider|CLion|PhpStorm|RubyMine|DataGrip|AndroidStudio/i, 'jetbrains', 'JetBrains IDE'],
  [/Xcode/i, 'xcode', 'Xcode'],
  [/\bvoid\b/i, 'void', 'Void'],
  [/\btrae\b/i, 'trae', 'Trae'],
  [/aider/i, 'aider', 'Aider'],
  [/goose/i, 'goose', 'Goose'],
  [/\bdroid\b|factory/i, 'droid', 'Factory Droid'],
  [/openhands/i, 'openhands', 'OpenHands'],
  [/avante/i, 'avante', 'avante.nvim'],
  [/codecompanion/i, 'codecompanion', 'CodeCompanion.nvim'],
  [/gptel/i, 'gptel', 'gptel (Emacs)'],
  [/open-?webui/i, 'open-webui', 'Open WebUI'],
  [/lobe-?chat|lobehub/i, 'lobechat', 'LobeChat'],
  [/cherry-?studio/i, 'cherry-studio', 'Cherry Studio'],
  [/chatbox/i, 'chatbox', 'Chatbox'],
  [/anythingllm/i, 'anythingllm', 'AnythingLLM'],
  [/librechat/i, 'librechat', 'LibreChat'],
  [/sillytavern/i, 'sillytavern', 'SillyTavern'],
  [/typingmind/i, 'typingmind', 'TypingMind'],
  [/\bmsty\b/i, 'msty', 'Msty'],
  [/\bjan\b/i, 'jan', 'Jan'],
  [/n8n/i, 'n8n', 'n8n'],
  [/langchain|langgraph/i, 'langchain', 'LangChain'],
  [/llama-?index/i, 'llamaindex', 'LlamaIndex'],
  [/litellm/i, 'litellm', 'LiteLLM'],
  [/ai-sdk|vercel/i, 'ai-sdk', 'Vercel AI SDK'],
  [/open-gravity/i, 'open-gravity', 'Open Gravity'],
  [/OpenAI\/Python|openai-python/i, 'openai-python', 'OpenAI SDK (Python)'],
  [/OpenAI\/JS|openai-node/i, 'openai-js', 'OpenAI SDK (JS)'],
  [/OpenAI\/Java|openai-java/i, 'openai-java', 'OpenAI SDK (Java)'],
  [/OpenAI\/Go|openai-go/i, 'openai-go', 'OpenAI SDK (Go)'],
  [/OpenAI\/.NET|openai-dotnet/i, 'openai-dotnet', 'OpenAI SDK (.NET)'],
  [/Anthropic\/Python|anthropic-sdk-python/i, 'anthropic-python', 'Anthropic SDK (Python)'],
  [/Anthropic\/JS|anthropic-sdk-typescript/i, 'anthropic-js', 'Anthropic SDK (JS)'],
  [/google-genai-sdk|google-generativeai|genai-js/i, 'google-genai', 'Google GenAI SDK'],
  [/ollama-python|ollama-js/i, 'ollama-sdk', 'Ollama SDK'],
  [/\bcurl\//i, 'curl', 'curl'],
  [/PostmanRuntime/i, 'postman', 'Postman'],
  [/insomnia/i, 'insomnia', 'Insomnia'],
  [/python-requests|python-httpx|aiohttp|urllib/i, 'python', 'Python script'],
  [/node-fetch|undici|axios|\bnode\b/i, 'node', 'Node.js script'],
  [/Go-http-client/i, 'go', 'Go program'],
  [/Mozilla\//i, 'browser', 'Web browser'],
];

/** Friendly client identity from request headers. */
export function detectClient(headers: Headers): ClientId {
  const title = h1(headers, 'x-title') || h1(headers, 'x-client-name');
  const referer = h1(headers, 'http-referer') || h1(headers, 'referer');
  const originator = h1(headers, 'originator');
  const ua = h1(headers, 'user-agent');
  const goog = h1(headers, 'x-goog-api-client');
  for (const probe of [title, originator, referer, ua, goog]) {
    if (!probe) continue;
    for (const [re, id, name] of RULES) if (re.test(probe)) return { id, name };
  }
  // Unknown: group by the first product token of the User-Agent.
  const product = /^([A-Za-z][\w.-]{1,40})/.exec(ua)?.[1];
  if (product) return { id: `ua:${product.toLowerCase()}`, name: product };
  return { id: 'unknown', name: 'Unknown client' };
}

/** Detection for stored records that only kept the User-Agent. */
export function clientFromUserAgent(ua: string | undefined): ClientId {
  return detectClient({ 'user-agent': ua || '' });
}
