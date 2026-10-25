import { NextRequest, NextResponse } from 'next/server';
import { parseDevpostPage } from '@/lib/hackathon/parse';
import type { ChallengeSection } from '@/lib/types/hackathon';

/**
 * POST /api/hackathon/scrape
 *
 * Fetches a DevPost hackathon page, parses it with Cheerio, and returns
 * structured challenge information: the sectioned brief ("About the
 * challenge", "Why join", "What to build", "Requirements", "What to
 * Submit"), the technologies the organizers list, and the deadline.
 *
 * Request body:
 *   { url: string }         — DevPost hackathon URL (required)
 *
 * Response body:
 *   {
 *     success: boolean,
 *     title?: string,
 *     description?: string,
 *     theme?: string,
 *     tags?: string[],
 *     technologies?: string[],
 *     deadline?: string | null,
 *     sections?: ChallengeSection[],
 *     rawHtml?: string,      // truncated for agent context
 *     error?: string
 *   }
 */

interface ScrapeRequest {
  url: string;
}

interface ScrapeResponse {
  success: boolean;
  title?: string;
  description?: string;
  theme?: string;
  tags?: string[];
  technologies?: string[];
  deadline?: string | null;
  sections?: ChallengeSection[];
  rawHtml?: string;
  error?: string;
}

export async function POST(request: NextRequest) {
  let body: ScrapeRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ScrapeResponse>(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { url } = body;
  if (!url || typeof url !== 'string') {
    return NextResponse.json<ScrapeResponse>(
      { success: false, error: 'URL is required' },
      { status: 400 }
    );
  }

  // Only allow DevPost URLs for safety.
  if (!/devpost\.com/i.test(url)) {
    return NextResponse.json<ScrapeResponse>(
      { success: false, error: 'Only DevPost URLs are supported' },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return NextResponse.json<ScrapeResponse>(
        { success: false, error: `HTTP ${response.status}: ${response.statusText}` },
        { status: response.status }
      );
    }

    const html = await response.text();
    if (!html || html.length < 100) {
      return NextResponse.json<ScrapeResponse>(
        {
          success: false,
          error: 'Page returned little or no HTML content. It may require JavaScript rendering.',
        },
        { status: 502 }
      );
    }

    const parsed = parseDevpostPage(html);

    return NextResponse.json<ScrapeResponse>({
      success: true,
      title: parsed.title,
      description: parsed.description,
      theme: parsed.theme,
      tags: parsed.tags,
      technologies: parsed.technologies,
      deadline: parsed.deadline,
      sections: parsed.sections,
      rawHtml: html.slice(0, 8000),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Scrape failed unexpectedly';
    return NextResponse.json<ScrapeResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
