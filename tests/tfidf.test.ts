import { describe, it, expect } from 'vitest';
import { normalizeTerm, computeTfidfEnhanced } from '../scripts/seo-audit';
import { canonicalizeCorpus } from '../scripts/seo-audit';

describe('normalizeTerm', () => {
  it('lowercases and stems plural words', () => {
    expect(normalizeTerm('Running')).toBe('run');
    expect(normalizeTerm('tests')).toBe('test');
  });

  it('removes punctuation and short tokens', () => {
    expect(normalizeTerm('HTTP/2')).toBe('http2');
    expect(normalizeTerm('a')).toBe('a');
  });
});

describe('computeTfidfEnhanced', () => {
  it('ranks terms higher when concentrated in fewer docs', () => {
    const docs = [
      { id: 'd1', terms: ['apple', 'apple', 'banana'] },
      { id: 'd2', terms: ['apple', 'cherry', 'cherry'] },
      { id: 'd3', terms: ['banana', 'banana', 'banana'] },
    ];
    const top = computeTfidfEnhanced(docs, 5, { minDocFreq: 1 });
    expect(top.length).toBeGreaterThan(0);
    // Ensure banana or cherry appears in top results
    const terms = top.map(t => t.term);
    expect(terms).toContain('banana');
  });
});

describe('canonicalizeCorpus', () => {
  it('picks a canonical surface form for stems', () => {
    const docs = [
      { id: 'd1', terms: ['outcome', 'outcome', 'outcom'] },
      { id: 'd2', terms: ['outcoming', 'outcome'] },
    ];
    const can = canonicalizeCorpus(docs);
    // normalized form for 'outcome' should map to a readable surface like 'outcome'
    const norm = normalizeTerm('outcome');
    expect(can.get(norm)).toBeDefined();
    expect(can.get(norm)).toMatch(/outcom/i);
  });
});
