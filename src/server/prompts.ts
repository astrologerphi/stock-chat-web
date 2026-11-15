import { Config } from './db.ts';
import type { PromptConfig, PromptItem } from '../shared/types.ts';

export const DEFAULT_PROMPTS: PromptConfig = {
  scorePrompts: [
    {
      id: 'pop_culture',
      title: 'Pop Icon',
      description: 'The potential of this company, or its leader, or its product to become a popular culture symbol.',
    },
    {
      id: 'moat',
      title: 'Moat',
      description: 'How durable and defensible is this company’s competitive advantage (brand, network effects, switching costs, scale, IP)?',
    },
    {
      id: 'momentum',
      title: 'Momentum',
      description: 'How strong is the current narrative and business momentum based on recent news, growth and market attention?',
    },
    {
      id: 'ai_exposure',
      title: 'AI Upside',
      description: 'How much could this company benefit from the adoption of artificial intelligence over the next five years?',
    },
  ],
  svgPrompts: [
    {
      id: 'business_map',
      title: 'Business Map',
      description:
        'A clear infographic of how this company makes money: its main segments or product lines, the customers they serve, and how value flows between them.',
    },
    {
      id: 'competitive_landscape',
      title: 'Competitive Landscape',
      description: 'A positioning map of this company against its 4–6 most important competitors, with short labels explaining each one’s edge.',
    },
  ],
  introPrompt:
    'Write an engaging, well-structured introduction to this company for a curious investor: what it does, how it makes money, what makes it distinctive, key people, and the most important recent developments. Use short markdown sections with headings and bullet points where useful. Around 300–450 words.',
};

const ID_RE = /^[a-z0-9_]{1,40}$/;

export async function getPrompts(): Promise<PromptConfig> {
  const doc = await Config.findOne({ key: 'prompts' }).lean<{ prompts?: PromptConfig }>();
  return doc?.prompts ?? DEFAULT_PROMPTS;
}

function cleanItems(input: unknown, max: number): PromptItem[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set<string>();
  const out: PromptItem[] = [];
  for (const raw of input.slice(0, max)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const title = String(r.title ?? '').trim().slice(0, 60);
    const description = String(r.description ?? '').trim().slice(0, 2000);
    let id = String(r.id ?? '').trim();
    if (!ID_RE.test(id) || ids.has(id)) id = `p_${Math.random().toString(36).slice(2, 10)}`;
    if (!title || !description) continue;
    ids.add(id);
    out.push({ id, title, description });
  }
  return out;
}

export async function savePrompts(input: Partial<PromptConfig>): Promise<PromptConfig> {
  const prompts: PromptConfig = {
    scorePrompts: cleanItems(input.scorePrompts, 20),
    svgPrompts: cleanItems(input.svgPrompts, 6),
    introPrompt: String(input.introPrompt ?? '').trim().slice(0, 4000),
  };
  await Config.updateOne({ key: 'prompts' }, { $set: { prompts } }, { upsert: true });
  return prompts;
}
