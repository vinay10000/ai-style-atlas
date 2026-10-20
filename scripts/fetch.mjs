#!/usr/bin/env node
/**
 * Pull the AI Style Atlas out of Futurepedia's public viewer API.
 *
 *   node scripts/fetch.mjs
 *
 * Writes:
 *   data/styles.json       metadata for all 86 styles
 *   prompts/NNN-slug.md    the exact prompt text for each style
 *   INDEX.md               generated list of every style
 *
 * The site has two prompt options. We use its own defaults:
 * no voiceover timing, with the storyboard-first step.
 * Change the flags below if you want the other variants.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://www.futurepedia.io";
const PAGE_SIZE = 15;
const EXPECTED_STYLES = 86;
const CONCURRENCY = 3;
const RETRIES = 5;

// The site's defaults. Flip voiceover to true if you want prompts that expect
// an SRT or word-level timestamps.
const PROMPT_OPTIONS = {
  content: "",
  srt: "",
  voiceover: false,
  storyboard: true,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url, init = {}, attempt = 0) {
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (attempt >= RETRIES) throw error;
    await sleep(1000 * 2 ** attempt);
    return request(url, init, attempt + 1);
  }

  if (response.ok) return response;

  const retryable = response.status === 429 || response.status >= 500;
  if (retryable && attempt < RETRIES) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : 1000 * 2 ** attempt;
    console.warn(`  ${response.status} from ${url}, retrying in ${wait}ms`);
    await sleep(wait);
    return request(url, init, attempt + 1);
  }

  const body = await response.text().catch(() => "");
  throw new Error(`${response.status} ${response.statusText} from ${url}\n${body.slice(0, 300)}`);
}

async function getJSON(url) {
  const response = await request(url);
  return response.json();
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fileNameFor(style) {
  return `${String(style.order).padStart(3, "0")}-${slugify(style.name)}.md`;
}

async function loadStyles() {
  const styles = [];
  let page = 1;

  while (true) {
    const url = `${ORIGIN}/api/style-atlas/styles?category=All&page=${page}`;
    process.stdout.write(`Fetching style list, page ${page}... `);
    const payload = await getJSON(url);
    const batch = Array.isArray(payload.styles) ? payload.styles : [];
    styles.push(...batch);
    console.log(`${batch.length} styles`);

    if (!payload.hasMore || batch.length === 0) break;
    page += 1;
    if (page > Math.ceil(EXPECTED_STYLES / PAGE_SIZE) + 2) {
      throw new Error("Style pagination did not stop. The API may have changed.");
    }
  }

  const ids = new Set(styles.map((style) => style.styleId));
  if (styles.length !== EXPECTED_STYLES || ids.size !== EXPECTED_STYLES) {
    throw new Error(
      `Expected ${EXPECTED_STYLES} unique styles, got ${styles.length} rows and ${ids.size} ids.`
    );
  }

  styles.sort((a, b) => a.order - b.order);
  return styles;
}

async function loadPrompt(style) {
  const url = `${ORIGIN}/api/style-atlas/prompt/${encodeURIComponent(style.styleId)}`;
  const response = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(PROMPT_OPTIONS),
  });
  const payload = await response.json();
  const prompt = payload?.prompt;

  if (typeof prompt !== "string" || prompt.length < 1000) {
    throw new Error(`Prompt for ${style.styleId} looks empty or truncated.`);
  }
  if (!prompt.includes(style.name)) {
    throw new Error(`Prompt for ${style.styleId} does not mention its style name.`);
  }
  return prompt;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function categoryOrder(styles) {
  const seen = new Set();
  const ordered = [];
  for (const style of styles) {
    if (!seen.has(style.category)) {
      seen.add(style.category);
      ordered.push(style.category);
    }
  }
  return ordered;
}

function renderIndex(styles, generatedAt) {
  const categories = categoryOrder(styles);
  const lines = [
    "# Index",
    "",
    `${styles.length} styles, grouped the same way as the atlas. Every link opens the full prompt for that style.`,
    "",
    `Generated ${generatedAt} from the [AI Style Atlas](${ORIGIN}/resources/ai-style-atlas/view).`,
    "",
  ];

  for (const category of categories) {
    const inCategory = styles.filter((style) => style.category === category);
    lines.push(`## ${category} (${inCategory.length})`, "");
    for (const style of inCategory) {
      const number = String(style.order).padStart(2, "0");
      lines.push(
        `- **#${number} [${style.name}](${style.file})**`,
        `  ${style.description}`,
        ""
      );
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

async function main() {
  const styles = await loadStyles();
  console.log(`\nFetching ${styles.length} prompts (this is about 9 MB)...\n`);

  const prompts = await mapLimit(styles, CONCURRENCY, async (style, index) => {
    const prompt = await loadPrompt(style);
    const label = `${String(index + 1).padStart(2, "0")}/${styles.length}`;
    console.log(`${label}  ${String(style.order).padStart(2, "0")}  ${style.name}  ${(prompt.length / 1024).toFixed(0)} KB`);
    return prompt;
  });

  const generatedAt = new Date().toISOString();
  const promptDir = join(ROOT, "prompts");
  const dataDir = join(ROOT, "data");
  await mkdir(promptDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  const manifest = [];
  for (let i = 0; i < styles.length; i += 1) {
    const style = styles[i];
    const file = fileNameFor(style);
    const prompt = prompts[i];
    await writeFile(join(promptDir, file), `${prompt.trimEnd()}\n`, "utf8");

    manifest.push({
      order: style.order,
      styleId: style.styleId,
      name: style.name,
      category: style.category,
      description: style.description,
      explainerNote: style.explainerNote,
      motion: style.motion,
      file: `prompts/${file}`,
      promptBytes: Buffer.byteLength(prompt, "utf8"),
      poster: style.s3PosterImageUrl,
      explainerVideo: style.s3ExplainerVideoUrl,
      styleClip: style.s3ClipVideoUrl,
    });
  }

  const data = {
    title: "The AI Style Atlas",
    source: `${ORIGIN}/resources/ai-style-atlas/view`,
    generatedAt,
    count: manifest.length,
    promptOptions: PROMPT_OPTIONS,
    categories: categoryOrder(styles).map((name) => ({
      name,
      count: manifest.filter((style) => style.category === name).length,
    })),
    styles: manifest,
  };

  await writeFile(
    join(dataDir, "styles.json"),
    `${JSON.stringify(data, null, 2)}\n`,
    "utf8"
  );
  await writeFile(join(ROOT, "INDEX.md"), renderIndex(manifest, generatedAt.slice(0, 10)), "utf8");

  const total = manifest.reduce((sum, style) => sum + style.promptBytes, 0);
  console.log(
    `\nDone. ${manifest.length} prompts, ${(total / 1024 / 1024).toFixed(1)} MB.`
  );
}

main().catch((error) => {
  console.error(`\nFetch failed: ${error.message}`);
  process.exitCode = 1;
});
