import { getLLMClient, LLM_MODEL } from '@/lib/agents/client';
import type { HackathonBrief } from '@/lib/types/hackathon';
import type {
  ConsultantDraft,
  ConsultantMessage,
  ProjectIdea,
} from '@/lib/types/idea';

/**
 * The consultant is the conversational half of the hackathon intake: it
 * reads the scraped challenge brief, proposes buildable ideas, and then
 * works with the team to shape one of them into a concrete project plan.
 */

const MAX_IDEAS = 6;
const MAX_TECH_ITEMS = 8;
const MAX_TECH_ITEM_LENGTH = 32;
const MAX_HISTORY = 10;

export interface ConsultantTurn {
  /** Conversational reply shown in the chat thread. */
  reply: string;
  /** Updated project name. */
  name: string;
  /** Updated project description. */
  description: string;
  /** Updated tech stack. */
  techStack: string[];
}

const IDEAS_SYSTEM_PROMPT = `You are a senior hackathon strategist. A team is about to enter a hackathon and needs to pick what to build.

You are given the full challenge brief: what the challenge is about, why the organizers want participants, what they ask you to build, the requirements, and exactly what has to be submitted.

Propose distinct project ideas that:
- Directly satisfy the "What to build" and "Requirements" sections — never drift off-brief.
- Are realistic for a small team in the time remaining before the deadline.
- Are differentiated from each other in approach (different angle, not a reword of the same idea).
- Have a clear demo: something visible on screen that a judge can grasp in 30 seconds.
- Are scoped so the "What to Submit" checklist (repo, demo video, deployed link) is achievable.

For each idea give a memorable name, a one-line pitch, a 2-4 sentence description, a concrete tech stack, and a sentence on why it scores well against this specific brief.

Rules:
- Output valid JSON only, no commentary outside the JSON.
- Use the technologies the organizers list unless the idea genuinely needs something else.
- Never invent a prize amount, a sponsor, or a rule that is not in the brief.`;

const CONSULT_SYSTEM_PROMPT = `You are a friendly, sharp product consultant helping a team shape a hackathon project into something they can actually build and demo.

You are given the challenge brief and the team's current project draft. The team is talking to you like a consultant: they describe what they want, push back, add constraints, change their mind.

How to reply:
- First, one or two short sentences, conversational. Say what you understood and what you changed. Ask at most ONE sharp follow-up question, and only if the draft is still missing something that would matter to a judge.
- Then return the updated draft. The draft is what the team will build from, so it must be concrete: what it does, who it is for, the core flow, and what makes it demo-able.
- Keep the name short and memorable (2-4 words, no "AI-Powered" prefixes unless the brief demands it).
- Keep the description under 120 words, in plain language, no marketing fluff.
- The tech stack must be a realistic list of 3-6 concrete technologies. Prefer what the organizers list; only deviate when the team asks for it.

Rules:
- Output valid JSON only, no commentary outside the JSON.
- If the team's message does not change anything, still return the current draft unchanged.`;

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function sanitizeTechStack(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const tech = item.replace(/\s+/g, ' ').trim();
    if (!tech) continue;
    const cleaned = clamp(tech, MAX_TECH_ITEM_LENGTH);
    if (out.some((t) => t.toLowerCase() === cleaned.toLowerCase())) continue;
    out.push(cleaned);
    if (out.length >= MAX_TECH_ITEMS) break;
  }
  return out;
}

/** Render the parsed challenge sections as a markdown outline for the prompt. */
function buildOutline(brief: HackathonBrief, maxCharsPerSection = 1200): string {
  if (brief.sections.length === 0) return '(no structured sections captured)';
  return brief.sections
    .map((section) => {
      const level = Math.min(Math.max(section.level, 2), 6);
      const body = section.content.slice(0, maxCharsPerSection).trim();
      return `${'#'.repeat(level)} ${section.title}\n${body}`;
    })
    .join('\n\n');
}

function daysUntil(deadline: string | null): number | null {
  if (!deadline) return null;
  const target = new Date(deadline);
  if (isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function buildContextBlock(brief: HackathonBrief, maxCharsPerSection = 1200): string {
  const days = daysUntil(brief.deadline);
  const timeLeft =
    days === null
      ? 'Deadline unknown — assume a typical 48-72 hour hackathon build window.'
      : `Submission deadline: ${new Date(brief.deadline!).toUTCString()} (about ${days} day${days === 1 ? '' : 's'} from now).`;

  const technologies = brief.technologies.length
    ? brief.technologies.join(', ')
    : '(not listed)';

  return `Hackathon: ${brief.title || '(untitled hackathon)'}
Theme / track: ${brief.theme || '(not stated)'}
Tags: ${brief.tags.length ? brief.tags.join(', ') : '(none)'}
Technologies listed by the organizers: ${technologies}
${timeLeft}
Source: ${brief.url || '(unknown)'}

Challenge brief:
${brief.description || '(no summary available)'}

${buildOutline(brief, maxCharsPerSection)}`;
}

function sanitizeIdeas(raw: unknown): ProjectIdea[] {
  const list = Array.isArray(raw) ? raw : (raw as { ideas?: unknown })?.ideas;
  if (!Array.isArray(list)) return [];

  const used = new Set<string>();
  const out: ProjectIdea[] = [];

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;

    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name) continue;

    const key = name.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);

    const description =
      typeof record.description === 'string' ? record.description.trim() : '';
    if (!description) continue;

    const tagline = typeof record.tagline === 'string' ? record.tagline.trim() : '';
    const whyItFits =
      typeof record.whyItFits === 'string' ? record.whyItFits.trim() : '';

    out.push({
      id: `idea_${out.length + 1}_${key.replace(/[^a-z0-9]+/g, '_').slice(0, 24)}`,
      name: clamp(name, 60),
      tagline: clamp(tagline, 140),
      description: clamp(description, 900),
      techStack: sanitizeTechStack(record.techStack),
      whyItFits: clamp(whyItFits, 400),
    });

    if (out.length >= MAX_IDEAS) break;
  }

  return out;
}

export async function consultantSuggestIdeas(
  brief: HackathonBrief
): Promise<ProjectIdea[]> {
  const userPrompt = `${buildContextBlock(brief)}

Suggest ${4} project ideas this team could realistically build for this challenge.

Return ONLY a JSON object of the form:
{
  "ideas": [
    {
      "name": "Short memorable name",
      "tagline": "One line pitch",
      "description": "2-4 sentences: what it does, who it is for, the core flow.",
      "techStack": ["Framework", "Service", "Database"],
      "whyItFits": "One sentence on how it answers the brief."
    }
  ]
}`;

  const completion = await getLLMClient().chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: IDEAS_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  });

  const raw = JSON.parse(completion.choices[0].message.content || '{}');
  return sanitizeIdeas(raw);
}

export async function consultantRefine(
  brief: HackathonBrief,
  draft: ConsultantDraft,
  message: string,
  history: ConsultantMessage[] = []
): Promise<ConsultantTurn> {
  const conversation = history
    .slice(-MAX_HISTORY)
    .map((entry) => `${entry.role === 'user' ? 'Team' : 'Consultant'}: ${entry.content}`)
    .join('\n');

  const userPrompt = `${buildContextBlock(brief, 900)}

Current project draft:
Name: ${draft.name || '(not named yet)'}
Description: ${draft.description || '(empty)'}
Tech stack: ${draft.techStack.length ? draft.techStack.join(', ') : '(not decided)'}

${conversation ? `Conversation so far:\n${conversation}\n\n` : ''}Latest message from the team:
${message}

Reply conversationally and return the updated draft.
Return ONLY a JSON object of the form:
{
  "reply": "1-2 short conversational sentences, optionally ending in one question.",
  "name": "Updated project name",
  "description": "Updated project description",
  "techStack": ["Tech", "Tech", "Tech"]
}`;

  const completion = await getLLMClient().chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: CONSULT_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.5,
  });

  const raw = JSON.parse(completion.choices[0].message.content || '{}') as Record<
    string,
    unknown
  >;

  const reply =
    typeof raw.reply === 'string' && raw.reply.trim()
      ? raw.reply.trim()
      : 'Here is the updated draft.';

  const name =
    typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : draft.name;

  const description =
    typeof raw.description === 'string' && raw.description.trim()
      ? raw.description.trim()
      : draft.description;

  const techStack = sanitizeTechStack(raw.techStack);

  return {
    reply,
    name,
    description,
    techStack: techStack.length ? techStack : draft.techStack,
  };
}
