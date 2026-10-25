import OpenAI from 'openai';

// Agnes AI is OpenAI-compatible — base URL comes from their docs
// (https://apihub.agnes-ai.com/v1). We use the official `openai` SDK so
// callers can use the standard `chat.completions.create()` interface.
let agnes: OpenAI | null = null;

export function getAgnesClient(): OpenAI {
  if (!agnes) {
    const apiKey = process.env.AGNES_API_KEY;
    if (!apiKey) {
      throw new Error(
        'AGNES_API_KEY environment variable is not set. Add it to .env.local to use Agnes-backed agents.'
      );
    }
    agnes = new OpenAI({
      baseURL: process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com/v1',
      apiKey,
    });
  }
  return agnes;
}