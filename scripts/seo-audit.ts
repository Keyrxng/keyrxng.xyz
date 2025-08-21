/*
  SEO Audit Script
  Usage:
    npx --yes tsx scripts/seo-audit.ts [--root ./src] [--out ./seo-report.json]

  This script crawls content under the given root (default ./src) and analyzes:
    - Titles, meta descriptions, headings
    - Word counts, reading ease (Flesch) and grade level
    - Internal vs external links, images without alt text
    - Keyword frequencies, n-grams (1-3), and TF-IDF across all documents
    - Flags missing/weak SEO elements (missing title/description/H1, long/short lengths)

  It supports .md, .mdx, .astro, .json files.
*/

import { promises as fs } from "node:fs";
import path from "node:path";
import { load as loadCheerio } from "cheerio";
import stemmer from "stemmer";

type DocumentMetrics = {
  filePath: string;
  routeHint: string;
  title?: string;
  description?: string;
  headings: { h1: string[]; h2: string[]; h3: string[] };
  wordCount: number;
  sentenceCount: number;
  fleschReadingEase: number;
  fleschKincaidGrade: number;
  internalLinks: string[];
  externalLinks: string[];
  imagesWithoutAlt: number;
  warnings: string[];
  tokens: string[];
  bigrams: string[];
  trigrams: string[];
  tfidfTerms: string[];
  topKeywords?: Array<{ term: string; tfidf: number }>;
};

type CorpusSummary = {
  totalDocuments: number;
  vocabularySize: number;
  topUnigrams: Array<{ term: string; tfidf: number }>;
  topBigrams: Array<{ term: string; tfidf: number }>;
  topTrigrams: Array<{ term: string; tfidf: number }>;
  pagesMissingTitle: string[];
  pagesMissingDescription: string[];
  pagesMissingH1: string[];
  duplicateTitles: Array<{ title: string; files: string[] }>;
};

type Report = {
  generatedAt: string;
  rootDir: string;
  documents: DocumentMetrics[];
  summary: CorpusSummary;
};

// Additional stopwords for domains, code, assets, docs
const EXTRA_STOPWORDS = new Set<string>([
  "a","about","above","after","again","against","all",
  "am","an","and","any","are","as","at","be","because",
  "been","before","being","below","between","both","but",
  "by","could","did","do","does","doing","down","during",
  "each","few","for","from","further","had","has","have",
  "having","he","her","here","hers","herself","him","himself",
  "his","how","i","if","in","into","is","it","its","itself",
  "just","me","more","most","my","myself","no","nor","not","now","of",
  "off","on","once","only","or","other","our","ours","ourselves","out",
  "over","own","same","she","should","so","some","such","than","that",
  "the","their","theirs","them","themselves","then","there","these","they",
  "this","those","through","to","too","under","until","up","very","was","we",
  "were","what","when","where","which","while","who","whom","why","with","you",
  "your","yours","yourself","yourselves",
  "https","http","www","com","net","org","io","dev",
  "github","docs","doc","api","readme","license","faq",
  "png","jpg","jpeg","gif","webp","svg","pdf","xml","rss",
  "js","ts","tsx","jsx","css","html","md","mdx","astro","json",
  "import","export","const","var","let","function","return","class","interface",
  "npm","yarn","pnpm","node","bun","sitemap","og","meta","link","href","src","alt",
  "title","description","pr","ci","cd"
]);

const TEXT_EXTENSIONS = new Set([".md", ".mdx", ".astro", ".json", ".html"]);

function parseArgs(): { rootDir: string; outFile: string | null } {
  const args = process.argv.slice(2);
  let rootDir = "./src";
  let outFile: string | null = "./seo-report.json";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root" && args[i + 1]) {
      rootDir = args[i + 1];
      i++;
    } else if (arg === "--out" && args[i + 1]) {
      outFile = args[i + 1];
      i++;
    } else if (arg === "--stdout") {
      outFile = null;
    }
  }
  return { rootDir: path.resolve(process.cwd(), rootDir), outFile: outFile ? path.resolve(process.cwd(), outFile) : null };
}

async function walkFiles(startDir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      // If a directory doesn't exist or can't be read, skip it
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (TEXT_EXTENSIONS.has(ext)) {
          results.push(full);
        }
      }
    }
  }
  // Guard: if startDir doesn't exist, return empty list
  try {
    const st = await fs.stat(startDir);
    if (!st.isDirectory()) return [];
  } catch {
    return [];
  }
  await walk(startDir);
  return results.sort();
}

function stripFrontmatter(input: string): string {
  if (input.startsWith("---")) {
    const end = input.indexOf("\n---", 3);
    if (end !== -1) {
      return input.slice(end + 4);
    }
  }
  return input;
}

function readFrontmatterBlock(input: string): string | null {
  if (!input.startsWith("---")) return null;
  const end = input.indexOf("\n---", 3);
  if (end === -1) return null;
  return input.slice(3, end).trim();
}

function parseSimpleYaml(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = block.split(/\r?\n/);
  for (const line of lines) {
    const m = /^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function extractMetaFromAstroSource(raw: string): { title?: string; description?: string } {
  let title: string | undefined;
  let description: string | undefined;
  const start = raw.indexOf("---");
  if (start !== -1) {
    const end = raw.indexOf("\n---", start + 3);
    if (end !== -1) {
      const fm = raw.slice(start + 3, end);
      const titleAssign = /\b(?:const|let|var)\s+title\s*=\s*([`'"])([\s\S]*?)\1/.exec(fm);
      if (titleAssign) title = titleAssign[2].trim();
      const descAssign = /\b(?:const|let|var)\s+description\s*=\s*([`'"])([\s\S]*?)\1/.exec(fm);
      if (descAssign) description = descAssign[2].trim();
    }
  }
  if (!title) {
    const m = /<BaseLayout[^>]*\btitle=(["'])([^"']+)\1/i.exec(raw);
    if (m) title = m[2].trim();
  }
  if (!description) {
    const m = /<BaseLayout[^>]*\bdescription=(["'])([^"']+)\1/i.exec(raw);
    if (m) description = m[2].trim();
  }
  return { title, description };
}

function extractFrontmatterMeta(raw: string, ext: string): { title?: string; description?: string } {
  if (ext === ".md" || ext === ".mdx") {
    const block = readFrontmatterBlock(raw);
    if (block) {
      const m = parseSimpleYaml(block);
      return { title: m.title, description: m.description };
    }
    return {};
  }
  if (ext === ".astro") {
    return extractMetaFromAstroSource(raw);
  }
  return {};
}

function extractTitleFromHtml(html: string): string | undefined {
  try {
    const $ = loadCheerio(html);
    // Prefer <title>
    const t = $("title").first().text();
    if (t && t.trim()) return decodeHtmlEntities(t.trim());
    // Meta variants
    const mt = $('meta[name="title"]').attr("content") || $('meta[property="og:title"]').attr("content");
    if (mt) return decodeHtmlEntities(mt.trim());
    // Fallback to first H1
    const h1 = $("h1").first().text();
    if (h1 && h1.trim()) return textFromHtml(h1).trim();
  } catch {
    // Fall back to regex-based heuristics in case of parsing issues
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) return decodeHtmlEntities(titleMatch[1].trim());
    const metaTitle = html.match(/<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["'][^>]*>/i);
    if (metaTitle) return decodeHtmlEntities(metaTitle[1].trim());
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) return textFromHtml(h1Match[1]).trim();
  }
  return undefined;
}

function extractDescriptionFromHtml(html: string): string | undefined {
  try {
    const $ = loadCheerio(html);
    const md = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content");
    if (md) return decodeHtmlEntities(md.trim());
  } catch {
    const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i);
    if (metaDesc) return decodeHtmlEntities(metaDesc[1].trim());
  }
  return undefined;
}

function textFromHtml(htmlFragment: string): string {
  let s = htmlFragment
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[\s\S]*?\}/g, " ") // strip MDX expressions
    .replace(/\s+/g, " ")
    .trim();
  return decodeHtmlEntities(s);
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractHeadingsFromHtml(html: string): { h1: string[]; h2: string[]; h3: string[] } {
  try {
    const $ = loadCheerio(html);
    return {
      h1: $("h1").map((_, el) => textFromHtml($(el).text()).trim()).get().filter(Boolean),
      h2: $("h2").map((_, el) => textFromHtml($(el).text()).trim()).get().filter(Boolean),
      h3: $("h3").map((_, el) => textFromHtml($(el).text()).trim()).get().filter(Boolean),
    };
  } catch {
    const headings = { h1: [] as string[], h2: [] as string[], h3: [] as string[] };
    const regexes: Array<[RegExp, keyof typeof headings]> = [
      [/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "h1"],
      [/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "h2"],
      [/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "h3"],
    ];
    for (const [re, key] of regexes) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        headings[key].push(textFromHtml(m[1]).trim());
      }
    }
    return headings;
  }
}

function extractLinks(htmlOrMarkdown: string): { internal: string[]; external: string[] } {
  const internal: string[] = [];
  const external: string[] = [];
  try {
    const $ = loadCheerio(htmlOrMarkdown);
    $("a[href]").each((_, el) => {
      const url = $(el).attr("href") || "";
      if (isExternal(url)) external.push(url); else internal.push(url);
    });
    // Also parse markdown-style links as a fallback
    const mdLinkRe = /\[[^\]]*\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = mdLinkRe.exec(htmlOrMarkdown)) !== null) {
      const url = m[1].trim();
      if (isExternal(url)) external.push(url); else internal.push(url);
    }
  } catch {
    // Fallback to regex parsing
    const mdLinkRe = /\[[^\]]*\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = mdLinkRe.exec(htmlOrMarkdown)) !== null) {
      const url = m[1].trim();
      if (isExternal(url)) external.push(url); else internal.push(url);
    }
    const htmlLinkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
    while ((m = htmlLinkRe.exec(htmlOrMarkdown)) !== null) {
      const url = m[1].trim();
      if (isExternal(url)) external.push(url); else internal.push(url);
    }
  }
  return { internal, external };
}

function isExternal(href: string): boolean {
  if (!href) return false;
  if (href.startsWith("/") || href.startsWith("#") || href.startsWith(".")) return false;
  try {
    const u = new URL(href, "http://example.com");
    return !!u.host && !["example.com"].includes(u.host);
  } catch {
    return false;
  }
}

function countImagesWithoutAlt(input: string): number {
  let count = 0;
  try {
    const $ = loadCheerio(input);
    $("img").each((_, el) => {
      const alt = ($(el).attr("alt") || "").trim();
      if (!alt) count++;
    });
    // Markdown images fallback
    const mdImgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = mdImgRe.exec(input)) !== null) {
      const alt = (m[1] || "").trim();
      if (alt.length === 0) count++;
    }
  } catch {
    // Fallback to regex-only parsing
    const mdImgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = mdImgRe.exec(input)) !== null) {
      const alt = (m[1] || "").trim();
      if (alt.length === 0) count++;
    }
    const htmlImgRe = /<img[^>]*>/gi;
    while ((m = htmlImgRe.exec(input)) !== null) {
      const tag = m[0];
      const altMatch = tag.match(/alt=["']([^"']*)["']/i);
      if (!altMatch || altMatch[1].trim().length === 0) count++;
    }
  }
  return count;
}

function toWords(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[`~!@#$%^&*()_+={}[\]|\\:;"'<>,.?/\-]/g, " ")
    .split(/\s+/)
    .map(w => w.trim())
    .filter(Boolean)
    .filter(w => w.length > 1)
    .filter(w => !EXTRA_STOPWORDS.has(w))
    .filter(w => /[a-z]/.test(w))
    .filter(w => !/^\d+$/.test(w));
}

function filterTerms(terms: string[]): string[] {
  return terms
    .map(t => t.toLowerCase())
    .map(t => t.trim())
    .filter(Boolean)
    .filter(t => t.length > 1)
    .filter(t => !EXTRA_STOPWORDS.has(t))
    .filter(t => /[a-z]/.test(t))
    .filter(t => !/^\d+$/.test(t));
}

function buildNgrams(tokens: string[], n: number): string[] {
  const grams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    grams.push(tokens.slice(i, i + n).join(" "));
  }
  return grams;
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  let count = 0;
  const vowels = "aeiouy";
  let prevVowel = false;
  for (const ch of w) {
    const isVowel = vowels.includes(ch);
    if (isVowel && !prevVowel) count++;
    prevVowel = isVowel;
  }
  if (w.endsWith("e") && count > 1) count--;
  return Math.max(1, count);
}

function computeReadability(text: string): { fleschReadingEase: number; fleschKincaidGrade: number; wordCount: number; sentenceCount: number } {
  const sentences = text.split(/[.!?]+\s+/).filter(Boolean);
  // For readability we want raw-ish words, not heavily filtered SEO tokens
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const wordCount = words.length;
  const sentenceCount = Math.max(1, sentences.length);
  let syllableCount = 0;
  for (const w of words) syllableCount += countSyllables(w);
  const wordsPerSentence = wordCount / sentenceCount;
  const syllablesPerWord = wordCount ? syllableCount / wordCount : 0;
  const fleschReadingEase = 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;
  const fleschKincaidGrade = 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;
  return { fleschReadingEase, fleschKincaidGrade, wordCount, sentenceCount };
}

function guessRouteHint(filePath: string, rootDir: string): string {
  const rel = path.relative(rootDir, filePath).replace(/\\/g, "/");
  // If inside pages/, reflect path without extension, index becomes '/'
  const parts = rel.split("/");
  const pagesIdx = parts.indexOf("pages");
  if (pagesIdx !== -1) {
    const after = parts.slice(pagesIdx + 1).join("/");
    if (!after) return "/";
    const noExt = after.replace(/(index)?\.[^.]+$/, "");
    return "/" + noExt.replace(/\/index$/, "");
  }
  // Otherwise, content path
  return "/" + rel.replace(/\.[^.]+$/, "");
}

async function readJsonAsText(filePath: string): Promise<string> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw);
    const strings: string[] = [];
    function collect(val: unknown) {
      if (val == null) return;
      if (typeof val === "string") strings.push(val);
      else if (Array.isArray(val)) for (const v of val) collect(v);
      else if (typeof val === "object") for (const v of Object.values(val as Record<string, unknown>)) collect(v);
    }
    collect(data);
    return strings.join("\n");
  } catch {
    return "";
  }
}

async function loadFileText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  const raw = await fs.readFile(filePath, "utf8");
  if (ext === ".json") return await readJsonAsText(filePath);
  if (ext === ".md" || ext === ".mdx") {
    return stripFrontmatter(raw)
      .replace(/```[\s\S]*?```/g, " ") // code blocks
      .replace(/`[^`]*`/g, " ") // inline code
      .replace(/<[^>]+>/g, " ") // mdx tags
      .replace(/\{[\s\S]*?\}/g, " ") // mdx expressions
      ;
  }
  if (ext === ".astro") {
    // drop frontmatter fence --- ... ---
    const withoutFrontmatter = stripFrontmatter(raw);
    return withoutFrontmatter;
  }
  return raw;
}

async function analyzeFile(filePath: string, rootDir: string): Promise<DocumentMetrics> {
  // Read original file content (for frontmatter extraction) and a processed text version
  const originalRaw = await fs.readFile(filePath, "utf8");
  const raw = await loadFileText(filePath);
  const routeHint = guessRouteHint(filePath, rootDir);
  const ext = path.extname(filePath).toLowerCase();
  const isHtmlLike = ext === ".astro" || ext === ".html";
  const title = isHtmlLike ? extractTitleFromHtml(raw) : undefined;
  const description = isHtmlLike ? extractDescriptionFromHtml(raw) : undefined;
  const fmMeta = extractFrontmatterMeta(originalRaw, ext);
  const finalTitle = title ?? fmMeta.title;
  const finalDescription = description ?? fmMeta.description;
  let headings = isHtmlLike ? extractHeadingsFromHtml(raw) : extractMdHeadings(raw);
  // If the source doesn't contain an explicit H1 but the title exists in frontmatter
  // (or the JSON has a `name`), treat that as the H1. This avoids false positives
  // for MDX/ASTRO pages that render the H1 via a layout using the frontmatter title.
  if ((headings.h1.length === 0) && finalTitle) {
    headings.h1 = [finalTitle];
  } else if ((headings.h1.length === 0) && ext === ".json") {
    // Try to parse a `name` field from the JSON file as a fallback H1
    try {
      const rawJson = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed.name === "string" && parsed.name.trim()) headings.h1 = [parsed.name.trim()];
    } catch {
      // ignore parse errors; keep headings empty
    }
  }
  const links = extractLinks(raw);
  const imagesWithoutAlt = countImagesWithoutAlt(raw);

  const text = isHtmlLike ? textFromHtml(raw) : raw
    .replace(/^\s*#+\s+/gm, " ")
    .replace(/\[[^\]]*\]\(([^)]+)\)/g, " ")
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, " ")
    .replace(/\{[\s\S]*?\}/g, " ")
    .replace(/<[^>]+>/g, " ");

  const { fleschReadingEase, fleschKincaidGrade, wordCount, sentenceCount } = computeReadability(text);
  const tokens = toWords(text);
  const bigrams = buildNgrams(tokens, 2);
  const trigrams = buildNgrams(tokens, 3);
  // Weighted terms for TF-IDF emphasizing title/description/headings
  const tfidfTerms: string[] = [];
  const pushWeighted = (s: string | undefined, weight: number) => {
    if (!s) return;
    const ws = toWords(s);
    for (let i = 0; i < weight; i++) tfidfTerms.push(...ws);
  };
  pushWeighted(finalTitle, 5);
  pushWeighted(finalDescription, 4);
  for (const h of headings.h1) pushWeighted(h, 4);
  for (const h of headings.h2) pushWeighted(h, 3);
  for (const h of headings.h3) pushWeighted(h, 2);
  tfidfTerms.push(...tokens);

  // Filter TF-IDF candidate terms to remove noise
  const filteredTfidf = filterTerms(tfidfTerms);

  const warnings: string[] = [];
  if (!finalTitle) warnings.push("Missing <title>");
  if (!finalDescription) warnings.push("Missing meta description");
  if (headings.h1.length === 0) warnings.push("Missing H1 heading");
  if (finalDescription && (finalDescription.length < 50 || finalDescription.length > 160)) warnings.push(`Description length ${finalDescription.length} (recommended 50-160)`);
  if (finalTitle && (finalTitle.length < 15 || finalTitle.length > 65)) warnings.push(`Title length ${finalTitle.length} (recommended 15-65)`);

  return {
    filePath,
    routeHint,
    title: finalTitle,
    description: finalDescription,
    headings,
    wordCount,
    sentenceCount,
    fleschReadingEase,
    fleschKincaidGrade,
    internalLinks: links.internal,
    externalLinks: links.external,
    imagesWithoutAlt,
    warnings,
    tokens,
    bigrams,
    trigrams,
  tfidfTerms: filteredTfidf,
  };
}

function extractMdHeadings(md: string): { h1: string[]; h2: string[]; h3: string[] } {
  const h1: string[] = [];
  const h2: string[] = [];
  const h3: string[] = [];
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    const m1 = /^\s*#\s+(.+)$/.exec(line);
    if (m1) { h1.push(m1[1].trim()); continue; }
    const m2 = /^\s*##\s+(.+)$/.exec(line);
    if (m2) { h2.push(m2[1].trim()); continue; }
    const m3 = /^\s*###\s+(.+)$/.exec(line);
    if (m3) { h3.push(m3[1].trim()); continue; }
  }
  return { h1, h2, h3 };
}

// Normalize tokens: lowercase, strip punctuation, stem
export function normalizeTerm(t: string): string {
  const s = t.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  if (!s) return "";
  // Avoid stemming numbers and short tokens
  if (/^\d+$/.test(s) || s.length <= 2) return s;
  try {
    return stemmer(s);
  } catch {
    return s;
  }
}

/**
 * Improved TF-IDF: uses sublinear TF (1 + log(tf)), smoothed IDF, stemming/normalization,
 * and a minDocFreq threshold to exclude extremely rare terms that are usually noise.
 */
export function computeTfidfEnhanced(allDocs: { id: string; terms: string[] }[], topK = 25, opts?: { minDocFreq?: number }) {
  const minDocFreq = opts?.minDocFreq ?? 2;
  const docCount = allDocs.length;
  const termDocFreq = new Map<string, number>();
  // Build a canonical surface-form map: normalized -> { surface -> count }
  const surfaceMap = new Map<string, Map<string, number>>();
  // Document frequency (on normalized terms)
  for (const d of allDocs) {
    const normals = d.terms.map(normalizeTerm).filter(Boolean);
    const unique = new Set(normals);
    for (let i = 0; i < d.terms.length; i++) {
      const surf = d.terms[i];
      const norm = normalizeTerm(surf);
      if (!norm) continue;
      let m = surfaceMap.get(norm);
      if (!m) { m = new Map(); surfaceMap.set(norm, m); }
      m.set(surf, (m.get(surf) || 0) + 1);
    }
    for (const t of unique) termDocFreq.set(t, (termDocFreq.get(t) || 0) + 1);
  }
  const tfidfScores = new Map<string, number>();
  for (const d of allDocs) {
    const tf = new Map<string, number>();
    for (const t0 of d.terms) {
      const t = normalizeTerm(t0);
      if (!t) continue;
      tf.set(t, (tf.get(t) || 0) + 1);
    }
    const entries = Array.from(tf.entries());
    for (const [t, f] of entries) {
      const df = termDocFreq.get(t) || 0;
      if (df < minDocFreq) continue; // skip very rare terms
      // sublinear tf
      const subtf = 1 + Math.log(f);
      const idf = Math.log((docCount + 1) / (df + 1)) + 1; // smoothed
      const score = subtf * idf;
      tfidfScores.set(t, (tfidfScores.get(t) || 0) + score);
    }
  }
  // Choose canonical surface form for each normalized term (most frequent surface)
  function canonicalForm(norm: string): string {
    const m = surfaceMap.get(norm);
    if (!m) return norm;
    // pick highest-count surface form; break ties by shortest length (prefer full words)
    let best = "";
    let bestCount = 0;
    for (const [surf, cnt] of m) {
      if (cnt > bestCount || (cnt === bestCount && (best === "" || surf.length < best.length))) {
        best = surf;
        bestCount = cnt;
      }
    }
    return best || norm;
  }

  const arr = Array.from(tfidfScores.entries()).map(([term, tfidf]) => ({ term: canonicalForm(term), tfidf }));
  arr.sort((a, b) => b.tfidf - a.tfidf);
  return arr.slice(0, topK);
}

export function canonicalizeCorpus(allDocs: { id: string; terms: string[] }[]) {
  const surfaceMap = new Map<string, Map<string, number>>();
  for (const d of allDocs) {
    for (const surf of d.terms) {
      const norm = normalizeTerm(surf);
      if (!norm) continue;
      let m = surfaceMap.get(norm);
      if (!m) { m = new Map(); surfaceMap.set(norm, m); }
      m.set(surf, (m.get(surf) || 0) + 1);
    }
  }
  const canonical = new Map<string, string>();
  for (const [norm, m] of surfaceMap) {
    let best = "";
    let bestCount = 0;
    for (const [surf, cnt] of m) {
      if (cnt > bestCount || (cnt === bestCount && (best === "" || surf.length < best.length))) {
        best = surf;
        bestCount = cnt;
      }
    }
    canonical.set(norm, best || norm);
  }
  return canonical;
}

async function generateReport(rootDir: string): Promise<Report> {
  const files = await walkFiles(rootDir);
  const documents: DocumentMetrics[] = [];
  // Limit concurrency to avoid overwhelming the system
  const concurrency = 8;
  let i = 0;
  async function worker() {
    while (i < files.length) {
      const idx = i++;
      const f = files[idx];
      try {
        const doc = await analyzeFile(f, rootDir);
        documents.push(doc);
      } catch (err) {
        console.error(`Failed to analyze ${f}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => worker()));

  const pagesMissingTitle = documents.filter(d => !d.title).map(d => d.filePath);
  const pagesMissingDescription = documents.filter(d => !d.description).map(d => d.filePath);
  const pagesMissingH1 = documents.filter(d => d.headings.h1.length === 0).map(d => d.filePath);

  // Helper: treat certain JSON data directories as data-only (cards) and
  // exclude them from missing-title/description/H1 warnings because they
  // don't correspond to standalone pages with their own <title>/<meta>.
  function isDataOnlyJson(p: string) {
    const rel = path.relative(rootDir, p).replace(/\\/g, "/");
    if (!rel) return false;
    if (!rel.endsWith(".json")) return false;
    return rel.startsWith("competencies/") || rel.startsWith("technologies/");
  }

  const filteredPagesMissingTitle = pagesMissingTitle.filter(p => !isDataOnlyJson(p));
  const filteredPagesMissingDescription = pagesMissingDescription.filter(p => !isDataOnlyJson(p));
  const filteredPagesMissingH1 = pagesMissingH1.filter(p => !isDataOnlyJson(p));

  const titleMap = new Map<string, string[]>();
  for (const d of documents) {
    if (!d.title) continue;
    titleMap.set(d.title, [...(titleMap.get(d.title) || []), d.filePath]);
  }
  const duplicateTitles = Array.from(titleMap.entries())
    .filter(([, files]) => files.length > 1)
    .map(([title, files]) => ({ title, files }));

  const weightedUnigrams = documents.map(d => ({ id: d.filePath, terms: d.tfidfTerms }));
  const weightedBigrams = documents.map(d => ({ id: d.filePath, terms: buildNgrams(d.tfidfTerms, 2) }));
  const weightedTrigrams = documents.map(d => ({ id: d.filePath, terms: buildNgrams(d.tfidfTerms, 3) }));

  const topUnigrams = computeTfidfEnhanced(weightedUnigrams, 40, { minDocFreq: 2 });
  const topBigrams = computeTfidfEnhanced(weightedBigrams, 30, { minDocFreq: 2 });
  const topTrigrams = computeTfidfEnhanced(weightedTrigrams, 20, { minDocFreq: 2 });

  const vocab = new Set<string>();
  for (const d of documents) for (const t of d.tokens) vocab.add(t);

  const summary: CorpusSummary = {
    totalDocuments: documents.length,
    vocabularySize: vocab.size,
    topUnigrams,
    topBigrams,
    topTrigrams,
    pagesMissingTitle: filteredPagesMissingTitle,
    pagesMissingDescription: filteredPagesMissingDescription,
    pagesMissingH1: filteredPagesMissingH1,
    duplicateTitles,
  };

  // Compute canonical surface forms and global IDF using normalized terms
  const minDocFreq = 2;
  const docCount = weightedUnigrams.length;
  const termDocFreq = new Map<string, number>();
  for (const d of weightedUnigrams) {
    const unique = new Set(d.terms.map(normalizeTerm).filter(Boolean));
    for (const t of unique) termDocFreq.set(t, (termDocFreq.get(t) || 0) + 1);
  }
  const globalIdf = new Map<string, number>();
  for (const [t, df] of termDocFreq) {
    if (df < minDocFreq) continue;
    globalIdf.set(t, Math.log((docCount + 1) / (df + 1)) + 1);
  }

  const canonical = canonicalizeCorpus(weightedUnigrams);
  for (const d of documents) {
    const tf = new Map<string, number>();
    for (const t0 of d.tfidfTerms) {
      const t = normalizeTerm(t0);
      if (!t) continue;
      tf.set(t, (tf.get(t) || 0) + 1);
    }
    const scored: Array<{ term: string; tfidf: number }> = [];
    for (const [t, f] of tf) {
      const idf = globalIdf.get(t) || 0;
      if (idf === 0) continue;
      const score = (1 + Math.log(f)) * idf; // sublinear tf * idf
      const surf = canonical.get(t) || t;
      scored.push({ term: surf, tfidf: score });
    }
    scored.sort((a, b) => b.tfidf - a.tfidf);
    d.topKeywords = scored.slice(0, 12);
  }

  return {
    generatedAt: new Date().toISOString(),
    rootDir,
    documents,
    summary,
  };
}

function printHumanSummary(report: Report) {
  const { summary } = report;
  console.log("\nSEO Audit Summary");
  console.log("================");
  console.log(`Documents: ${summary.totalDocuments}`);
  console.log(`Vocabulary size: ${summary.vocabularySize}`);
  console.log("");
  console.log("Top Unigrams:");
  for (const { term, tfidf } of summary.topUnigrams.slice(0, 20)) {
    console.log(`  ${term.padEnd(24)} ${tfidf.toFixed(3)}`);
  }
  console.log("");
  console.log("Top Bigrams:");
  for (const { term, tfidf } of summary.topBigrams.slice(0, 15)) {
    console.log(`  ${term.padEnd(28)} ${tfidf.toFixed(3)}`);
  }
  console.log("");
  console.log("Top Trigrams:");
  for (const { term, tfidf } of summary.topTrigrams.slice(0, 10)) {
    console.log(`  ${term.padEnd(32)} ${tfidf.toFixed(3)}`);
  }
  // Show top per-page keywords for the content pages by word count
  const docs = [...report.documents]
    .filter(d => d.wordCount > 150)
    .sort((a, b) => b.wordCount - a.wordCount)
  if (docs.length) {
    console.log("");
    console.log("Per-page top keywords (sample):");
    for (const d of docs) {
      console.log(`  - ${d.routeHint || d.filePath}`);
      const kws = (d.topKeywords || []).slice(0, 8).map(k => k.term);
      if (kws.length) console.log(`      ${kws.join(", ")}`);
    }
  }
  const warn = (label: string, arr: string[]) => {
    if (arr.length) {
      console.log("");
      console.log(`${label} (${arr.length}):`);
      for (const f of arr) console.log(`  - ${path.relative(process.cwd(), f)}`);
    }
  };
  warn("Pages missing <title>", summary.pagesMissingTitle);
  warn("Pages missing meta description", summary.pagesMissingDescription);
  warn("Pages missing H1", summary.pagesMissingH1);
  if (summary.duplicateTitles.length) {
    console.log("");
    console.log(`Duplicate titles (${summary.duplicateTitles.length}):`);
    for (const dup of summary.duplicateTitles) {
      console.log(`  • ${dup.title}`);
      for (const f of dup.files) console.log(`      - ${path.relative(process.cwd(), f)}`);
    }
  }
}

function renderMarkdown(report: Report): string {
  const { summary } = report;
  const lines: string[] = [];
  lines.push(`# SEO Audit — ${new Date(report.generatedAt).toLocaleString()}`);
  lines.push(`Generated for: \`${report.rootDir.replace(process.cwd() + path.sep, "./")}\``);
  lines.push(`\n## Snapshot\n\n- Documents: ${summary.totalDocuments}\n- Vocabulary size: ${summary.vocabularySize}\n`);

  function topList(title: string, items: Array<{ term: string; tfidf: number }>, limit = 10) {
    lines.push(`\n## ${title}\n`);
    lines.push("| Rank | Term | Score |");
    lines.push("|---:|---|---:|");
    for (let i = 0; i < Math.min(limit, items.length); i++) {
      const it = items[i];
      lines.push(`| ${i + 1} | ${it.term} | ${it.tfidf.toFixed(3)} |`);
    }
    lines.push("");
  }

  topList("Top Unigrams", summary.topUnigrams, 15);
  topList("Top Bigrams", summary.topBigrams, 12);
  topList("Top Trigrams", summary.topTrigrams, 10);

  // Per-page sample
  lines.push(`\n## Per-page top keywords (sample)\n`);
  const docs = [...report.documents].filter(d => d.wordCount > 150).sort((a, b) => b.wordCount - a.wordCount).slice(0, 40);
  for (const d of docs) {
    lines.push(`- **${d.routeHint || path.relative(process.cwd(), d.filePath)}** — ${d.wordCount} words`);
    const kws = (d.topKeywords || []).slice(0, 8).map(k => k.term);
    if (kws.length) lines.push(`  - Keywords: ${kws.join(", ")}`);
  }

  const warnBlock = (label: string, arr: string[]) => {
    lines.push(`\n## ${label} (${arr.length})\n`);
    if (arr.length === 0) { lines.push("None\n"); return; }
    for (const f of arr.slice(0, 200)) lines.push(`- ${path.relative(process.cwd(), f)}`);
    if (arr.length > 200) lines.push(`- ...and ${arr.length - 200} more`);
  };

  warnBlock("Pages missing <title>", summary.pagesMissingTitle);
  warnBlock("Pages missing meta description", summary.pagesMissingDescription);
  warnBlock("Pages missing H1", summary.pagesMissingH1);

  if (summary.duplicateTitles.length) {
    lines.push(`\n## Duplicate titles (${summary.duplicateTitles.length})\n`);
    for (const dup of summary.duplicateTitles) {
      lines.push(`- **${dup.title}**`);
      for (const f of dup.files) lines.push(`  - ${path.relative(process.cwd(), f)}`);
    }
  }

  lines.push(`\n---\n*Generated by seo-audit.ts*`);
  return lines.join("\n");
}

async function main() {
  const { rootDir, outFile } = parseArgs();
  const report = await generateReport(rootDir);
  if (outFile) {
    // Ensure parent dir exists
    try {
      await fs.mkdir(path.dirname(outFile), { recursive: true });
    } catch {}
    await fs.writeFile(outFile, JSON.stringify(report, null, 2), "utf8");
    console.log(`Wrote report to ${path.relative(process.cwd(), outFile)}`);
    // Also write a human-friendly markdown summary next to the JSON
    try {
      const md = renderMarkdown(report);
      const mdPath = outFile.replace(/\.json$/i, ".md");
      await fs.writeFile(mdPath, md, "utf8");
      console.log(`Wrote human summary to ${path.relative(process.cwd(), mdPath)}`);
    } catch (err) {
      console.error("Failed to write markdown summary:", err instanceof Error ? err.message : err);
    }
  } else {
    process.stdout.write(JSON.stringify(report, null, 2));
    // Also emit markdown file to cwd for easier reading
    try {
      const md = renderMarkdown(report);
      const mdPath = path.resolve(process.cwd(), "seo-report.md");
      await fs.writeFile(mdPath, md, "utf8");
      console.log(`Wrote human summary to ${path.relative(process.cwd(), mdPath)}`);
    } catch (err) {
      console.error("Failed to write markdown summary:", err instanceof Error ? err.message : err);
    }
  }
  printHumanSummary(report);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


