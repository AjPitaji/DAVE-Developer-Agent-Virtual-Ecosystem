import OpenAI from 'openai';

// Shared OpenAI-compatible client used by every agent in /lib/agents.
// Currently backed by Google Gemini via the OpenAI-compatible endpoint.
let client: OpenAI | null = null;

export function getLLMClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'GEMINI_API_KEY environment variable is not set. Add it to .env.local to enable AI agents.'
      );
    }
    client = new OpenAI({
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      apiKey,
    });
  }
  return client;
}

export const LLM_MODEL = 'gemini-2.5-flash';