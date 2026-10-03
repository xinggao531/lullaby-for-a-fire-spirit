// Sorting notes into projects. With a Claude API key the note (and any
// screenshot) goes to Claude, which splits it into separate ideas, cleans up the
// dictation and files each one under an existing or new project. Without a key,
// or offline, a keyword matcher files it by category instead and the note is
// marked so it can be re-sorted with Claude later.

import Anthropic from './vendor/anthropic-sdk.js';

export const MODEL = 'claude-opus-5-5';

export const CATEGORIES = [
  { id: 'interior-design', label: 'Interior design', emoji: '🛋️', group: 'Project ideas' },
  { id: 'games', label: 'Vibe-coding games', emoji: '🎮', group: 'Project ideas' },
  { id: 'websites', label: 'Websites', emoji: '🌐', group: 'Project ideas' },
  { id: 'apps', label: 'Apps', emoji: '📱', group: 'Project ideas' },
  { id: 'ai-videos', label: 'AI videos', emoji: '🎬', group: 'Project ideas' },
  { id: 'singing', label: 'Singing recordings', emoji: '🎤', group: 'Project ideas' },
  { id: 'photography', label: 'Photography', emoji: '📷', group: 'Project ideas' },
  { id: 'other-project', label: 'Other project ideas', emoji: '💡', group: 'Project ideas' },
  { id: 'wedding', label: 'Wedding planning', emoji: '💍', group: 'Life projects' },
  { id: 'reading', label: 'Reading list', emoji: '📚', group: 'Life projects' },
  { id: 'travel', label: 'Travel', emoji: '✈️', group: 'Life projects' },
  { id: 'health', label: 'Health & fitness', emoji: '🏃', group: 'Life projects' },
  { id: 'home-life', label: 'Home & errands', emoji: '🏡', group: 'Life projects' },
  { id: 'other-life', label: 'Other life stuff', emoji: '🗂️', group: 'Life projects' },
];

export const categoryById = (id) =>
  CATEGORIES.find((c) => c.id === id) || CATEGORIES.find((c) => c.id === 'other-project');

export const KINDS = ['idea', 'todo', 'reference', 'question', 'journal'];

// ---------- Claude ----------

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'note',
          'kind',
          'tags',
          'project_id',
          'new_project_name',
          'new_project_category',
          'project_summary',
        ],
        properties: {
          title: { type: 'string', description: 'Short headline for this note, 2-8 words.' },
          note: {
            type: 'string',
            description:
              "The note itself, cleaned up from dictation (filler words, false starts and repeats removed) but keeping all of the user's details and their voice. For a screenshot, what it shows and why it matters for the project.",
          },
          kind: { type: 'string', enum: KINDS },
          tags: { type: 'array', items: { type: 'string' }, description: '0-4 short lowercase tags.' },
          project_id: {
            type: 'string',
            description: 'id of the existing project this belongs to, or "" to create a new project.',
          },
          new_project_name: {
            type: 'string',
            description: 'Name for the new project when project_id is "", otherwise "".',
          },
          new_project_category: {
            type: 'string',
            enum: CATEGORIES.map((c) => c.id),
            description: 'Category of the project (existing or new).',
          },
          project_summary: {
            type: 'string',
            description:
              'An up-to-date 1-3 sentence summary of where the whole project stands, folding this note into the previous summary.',
          },
        },
      },
    },
  },
};

const SYSTEM = `You are the filing assistant inside Idea Catcher, a voice notebook the user talks to while walking the dog, driving or falling asleep. Their notes arrive as raw speech-to-text, sometimes with a phone screenshot attached.

For each message:
- Split it into separate items only when it clearly covers unrelated ideas; a single idea with several details stays one item.
- File every item under the existing project it belongs to whenever one fits. Only start a new project when nothing fits, and give it a short, specific name (e.g. "Living room makeover", "Cozy farming game", not "Ideas").
- Keep a project's category stable unless it is clearly wrong.
- Speech-to-text mangles names and words; fix obvious mis-hearings from context, but never invent details the user didn't say.
- Use the user's language for titles and notes.`;

export function hasKey() {
  return !!localStorage.getItem('ic.apiKey');
}

function client() {
  return new Anthropic({
    apiKey: localStorage.getItem('ic.apiKey'),
    dangerouslyAllowBrowser: true, // the key never leaves this phone except to call the API
  });
}

function projectList(projects) {
  if (!projects.length) return '(none yet)';
  return projects
    .map((p) => `- id: ${p.id} | name: ${p.name} | category: ${p.category} | summary: ${p.summary || '—'}`)
    .join('\n');
}

/**
 * @param {{text: string, image?: {base64: string, mediaType: string}, projects: object[], when: Date}} input
 * @returns {Promise<Array<object>>} organized items
 */
export async function organizeWithClaude({ text, image, projects, when }) {
  const content = [];
  if (image) {
    content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } });
  }
  content.push({
    type: 'text',
    text: `Existing projects:\n${projectList(projects)}\n\nNote recorded ${when.toLocaleString()}:\n"""\n${
      text || (image ? '(no words, just the screenshot above)' : '')
    }\n"""`,
  });

  const response = await client().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined to sort this note, so it was filed by keywords instead.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('The note was too long to sort in one go.');
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  const parsed = JSON.parse(textBlock.text);
  if (!Array.isArray(parsed.items) || !parsed.items.length) throw new Error('Claude returned no items.');
  return parsed.items;
}

// ---------- Offline keyword fallback ----------

const KEYWORDS = {
  'interior-design': ['interior', 'sofa', 'couch', 'paint', 'wall', 'living room', 'bedroom', 'kitchen', 'furniture', 'rug', 'lamp', 'decor', 'curtain', 'shelf', 'tile'],
  games: ['game', 'level', 'player', 'boss', 'enemy', 'quest', 'sprite', 'unity', 'godot', 'pixel', 'npc', 'gameplay'],
  websites: ['website', 'site', 'landing page', 'domain', 'blog', 'homepage', 'portfolio'],
  apps: ['app', 'iphone', 'android', 'notification', 'feature', 'ios'],
  'ai-videos': ['video', 'clip', 'scene', 'shot', 'sora', 'veo', 'runway', 'animation', 'storyboard', 'reel'],
  singing: ['sing', 'song', 'vocal', 'cover', 'recording', 'lyrics', 'melody', 'karaoke', 'harmony'],
  photography: ['photo', 'camera', 'lens', 'shoot', 'portrait', 'golden hour', 'lighting', 'edit', 'lightroom'],
  wedding: ['wedding', 'bride', 'groom', 'venue', 'guest', 'dress', 'florist', 'flowers', 'ceremony', 'reception', 'rsvp', 'caterer', 'honeymoon'],
  reading: ['book', 'read', 'novel', 'author', 'chapter', 'audiobook', 'kindle'],
  travel: ['trip', 'flight', 'hotel', 'travel', 'vacation', 'airbnb', 'itinerary'],
  health: ['gym', 'workout', 'run', 'diet', 'doctor', 'sleep', 'yoga', 'walk'],
  'home-life': ['buy', 'groceries', 'errand', 'call', 'appointment', 'bill', 'vet', 'dog'],
};

const STOP = new Set('the a an and or but to of for in on at with my our i we it this that is be about some maybe think should'.split(' '));
const words = (s) => (s.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []).filter((w) => w.length > 2 && !STOP.has(w));

export function organizeOffline({ text, projects }) {
  const lower = ` ${text.toLowerCase()} `;
  const noteWords = new Set(words(text));

  // 1. A project whose name the note mentions wins.
  let best = null;
  let bestScore = 0;
  for (const p of projects) {
    const nameWords = words(p.name);
    const hits = nameWords.filter((w) => noteWords.has(w)).length;
    const score = nameWords.length ? hits / nameWords.length : 0;
    if (hits && score > bestScore) {
      best = p;
      bestScore = score;
    }
  }

  // 2. Otherwise guess a category from keywords.
  let category = best?.category;
  if (!category) {
    let top = 0;
    for (const [cat, list] of Object.entries(KEYWORDS)) {
      const n = list.filter((k) => lower.includes(` ${k}`)).length;
      if (n > top) {
        top = n;
        category = cat;
      }
    }
  }
  category ||= 'other-project';

  const first = text.trim().split(/[.!?\n]/)[0].split(/\s+/).slice(0, 7).join(' ');
  const cat = categoryById(category);
  return [
    {
      title: first || 'Screenshot',
      note: text.trim(),
      kind: /\b(need to|have to|remember to|buy|call|book|todo|to do)\b/i.test(text) ? 'todo' : 'idea',
      tags: [],
      project_id: best?.id || '',
      new_project_name: best ? '' : `${cat.label} inbox`,
      new_project_category: category,
      project_summary: best?.summary || '',
    },
  ];
}
