/**
 * Pam — "has anyone already built this?"
 *
 * Pam answers the question a developer asks right before they start building
 * something: whether the problem has already been solved, and by whom. She
 * works in three steps:
 *
 *   1. Plan   — turn the developer's question into GitHub search queries.
 *   2. Search — run those queries against public GitHub (repositories, and
 *               optionally code) and collect the candidates.
 *   3. Summarize — pick the ones that genuinely answer the question and say
 *                  why, in the developer's terms.
 *
 * The whole thing is read-only and public-only. Pam never sees the team's
 * private repositories, and she never writes anything.
 */

import { getLLMClient, LLM_MODEL } from '@/lib/agents/client';
import {
  GithubRepo,
  mergeRepos,
  searchCode,
  searchRepositories,
} from '@/lib/github/search';

/** What Pam is being asked about. */
export interface PamContext {
  /** The developer's question, verbatim. */
  question: string;
  /** The project the question was asked from, when there is one. */
  projectName: string | null;
  projectDescription: string | null;
  repoUrl: string | null;
}

/** One recommended repository. */
export interface PamPick {
  fullName: string;
  /** One sentence on why this repo is relevant. */
  why: string;
  /** How close it is to what was asked. */
  fit: 'closest' | 'worth-a-look';
}

/** Everything the Pam panel needs to render one answer. */
export interface PamAnswer {
  /** One-line restatement of what Pam understood the question to be. */
  interpretation: string;
  /** The prose answer: has this been built, and by whom. */
  answer: string;
  /** The recommended repos, best first. */
  picks: PamPick[];
  /** The repo records behind the picks. */
  repos: GithubRepo[];
  /** The searches that were run, so the answer is auditable. */
  searches: string[];
  /** Non-fatal problems (rate limits, a rejected query, no results). */
  warnings: string[];
}

const MAX_REPO_QUERIES = 3;
const MAX_CODE_QUERIES = 2;
const MAX_CANDIDATES = 12;

const PLAN_PROMPT = `You turn a developer's question into GitHub search queries.

The question is usually asking whether something has already been built, how
someone else solved a technical problem, or what libraries exist for a job.

Rules for a repository query:
- Use concrete nouns that would actually appear in a repository name, description or README.
- Strip question words: "how do I", "is there a", "anyone know", "what is the best".
- Do NOT use quotes, parentheses, or boolean operators. GitHub's search parser rejects them and the whole query fails.
- Keep each query to about 6 words or fewer.
- Only use a \`language:\` qualifier when the question clearly implies one.
- Vary them: one narrow query, one broader query, one adjacent angle.

For a code query, target a specific symbol, library name or filename that
would literally appear inside source code.

Return ONLY a JSON object of the form:
{
  "interpretation": "one sentence restating what they are looking for",
  "repoQueries": ["query one", "query two"],
  "codeQueries": ["query one"]
}`;

const SUMMARY_PROMPT = `You are Pam. You have just searched public GitHub for
projects that do what the developer asked about.

Here are the candidates:
- owner/repo — description (language, N stars, topics: a, b)

Pick the ones that genuinely answer the question and give each one a single
sentence on why it is relevant. Be honest and specific: if nothing really
matches, say so plainly and suggest a better search angle instead of padding
the list. Never mention a repository that is not in the list above, and never
invent a reason for one that is.

Return ONLY a JSON object of the form:
{
  "answer": "2-4 sentences: has this been built, and what is the closest thing?",
  "picks": [
    { "fullName": "owner/repo", "why": "one sentence", "fit": "closest" }
  ]
}`;

/**
 * Strip characters that break GitHub's search parser.
 *
 * The LLM is told not to emit them, but a single stray quote kills the whole
 * query with a 422 — so we scrub defensively.
 */
export function sanitizeQuery(query: string): string {
  return query
    .replace(/["'`*()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** Turn the plan into a list of clean queries. */
function cleanQueries(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const cleaned = sanitizeQuery(raw);
    if (cleaned.length < 3) continue;
    if (!out.includes(cleaned)) out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

/** Ask the model for the searches to run. */
async function planSearches(ctx: PamContext): Promise<{
  interpretation: string;
  repoQueries: string[];
  codeQueries: string[];
}> {
  const projectContext = ctx.projectName
    ? `
The question was asked from inside this project, which gives you extra context
about the domain (use it to sharpen the queries, but the question itself is
what matters):
- Project: ${ctx.projectName}
- Description: ${ctx.projectDescription || '(none)'}
${ctx.repoUrl ? `- Repo: ${ctx.repoUrl}` : ''}`
    : '';

  const completion = await getLLMClient().chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: PLAN_PROMPT },
      {
        role: 'user',
        content: `Question: ${ctx.question}${projectContext}`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const raw = JSON.parse(completion.choices[0].message.content || '{}');

  return {
    interpretation:
      typeof raw.interpretation === 'string' && raw.interpretation.trim()
        ? raw.interpretation.trim()
        : ctx.question,
    repoQueries: cleanQueries(raw.repoQueries, MAX_REPO_QUERIES),
    codeQueries: cleanQueries(raw.codeQueries, MAX_CODE_QUERIES),
  };
}

/** Ask the model to pick the best candidates and explain them. */
async function summarizeFindings(
  ctx: PamContext,
  interpretation: string,
  candidates: GithubRepo[]
): Promise<{ answer: string; picks: PamPick[] }> {
  const list = candidates
    .map((r) => {
      const topics = r.topics.length ? `, topics: ${r.topics.join(', ')}` : '';
      return `- ${r.fullName} — ${r.description || '(no description)'} (${r.language || 'unknown language'}, ${r.stars} stars${topics})`;
    })
    .join('\n');

  const completion = await getLLMClient().chat.completions.create({
    model: LLM_MODEL,
    messages: [
      { role: 'system', content: SUMMARY_PROMPT },
      {
        role: 'user',
        content: `Question: ${ctx.question}
What they are looking for: ${interpretation}

Candidates found on GitHub:
${list}`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const raw = JSON.parse(completion.choices[0].message.content || '{}');

  const known = new Set(candidates.map((c) => c.fullName.toLowerCase()));
  const picks: PamPick[] = [];
  if (Array.isArray(raw.picks)) {
    for (const p of raw.picks) {
      if (!p || typeof p !== 'object') continue;
      const entry = p as Record<string, unknown>;
      const fullName = String(entry.fullName ?? '');
      // Only keep picks that actually came back from the search.
      if (!known.has(fullName.toLowerCase())) continue;

      const fit =
        entry.fit === 'worth-a-look' ? 'worth-a-look' : 'closest';
      const rawWhy = typeof entry.why === 'string' ? entry.why.trim() : '';

      picks.push({
        fullName,
        why: rawWhy || 'Relevant to what you asked about.',
        fit,
      });
      if (picks.length >= 6) break;
    }
  }

  return {
    answer:
      typeof raw.answer === 'string' && raw.answer.trim()
        ? raw.answer.trim()
        : 'Here is what I found on GitHub.',
    picks,
  };
}

/**
 * Run the whole Pam flow.
 *
 * Never throws for "nothing found" — that is a legitimate answer. It does
 * throw if the LLM itself is unreachable, since that is a real failure the
 * caller should surface.
 */
export async function pamResearch(
  ctx: PamContext,
  token: string | null
): Promise<PamAnswer> {
  const warnings: string[] = [];
  const searches: string[] = [];

  const plan = await planSearches(ctx);

  // --- Run the searches -------------------------------------------------
  const repoGroups: GithubRepo[][] = [];
  for (const query of plan.repoQueries) {
    // Forks are never what someone is looking for.
    const full = `${query} fork:false`;
    searches.push(query);
    const outcome = await searchRepositories(full, {
      token,
      perPage: 10,
      sort: 'stars',
    });
    if (outcome.warning) warnings.push(outcome.warning);
    repoGroups.push(outcome.repos);
  }

  const codeGroups: GithubRepo[][] = [];
  for (const query of plan.codeQueries) {
    searches.push(query);
    const outcome = await searchCode(query, { token, perPage: 10 });
    if (outcome.warning) warnings.push(outcome.warning);
    codeGroups.push(outcome.repos);
  }

  const candidates = mergeRepos([...repoGroups, ...codeGroups]).slice(
    0,
    MAX_CANDIDATES
  );

  // --- Nothing found ----------------------------------------------------
  if (candidates.length === 0) {
    return {
      interpretation: plan.interpretation,
      answer:
        warnings.length > 0
          ? 'I could not complete the search on GitHub, so I do not have an answer for you yet.'
          : 'I searched public GitHub and could not find anything close to this. It looks like a genuinely new problem — which is either very exciting or very risky. Try broadening the wording, or search for the underlying technique rather than the whole feature.',
      picks: [],
      repos: [],
      searches,
      warnings: [...new Set(warnings)],
    };
  }

  // --- Summarize --------------------------------------------------------
  const summary = await summarizeFindings(ctx, plan.interpretation, candidates);

  // Order the picks the way Pam ranked them, then attach the repo records.
  const byName = new Map(candidates.map((c) => [c.fullName.toLowerCase(), c]));
  const picks = summary.picks;
  const repos = picks
    .map((p) => byName.get(p.fullName.toLowerCase()))
    .filter((r): r is GithubRepo => !!r);

  return {
    interpretation: plan.interpretation,
    answer: summary.answer,
    picks,
    repos,
    searches,
    warnings: [...new Set(warnings)],
  };
}
