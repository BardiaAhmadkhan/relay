import fs from 'node:fs';
import path from 'node:path';

const internalCopy = /\b(?:Claude|Anthropic|Opus|Astra|OpenAI|ChatGPT|Qwen|Ollama|Gemini|Sonnet|GPT(?:[- ]?[0-9][\w.-]*)?|Luna|Sol|Terra)\b|\b(?:D-0\d{2,}|(?:claude|astra)-\d{3,})\b/i;

export function hasInternalCopy(text) {
  return internalCopy.test(text);
}

export function readPublicVision(file = path.resolve(process.env.RELAY_INSPECTION_VISION ?? 'docs/inspection-vision.md')) {
  const markdown = fs.readFileSync(file, 'utf8');
  if (hasInternalCopy(markdown)) throw new Error('The public presentation copy is awaiting review.');
  return markdown;
}
