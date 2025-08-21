import { defineCollection, z } from 'astro:content';

const writing = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    summary: z.string().max(280),
    publishedAt: z.string(),
    tags: z.array(z.string()).default([]),
    readingTime: z.string().optional(),
    relatedWorkSlug: z.string().optional(),
    ogImage: z.string().optional(),
    soWhat: z.string().optional(),
    hide: z.boolean().default(false),
  }),
});

const work = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    clientOrProject: z.string(),
    role: z.string(),
    year: z.string(),
    duration: z.string().optional(),
    thumbnail: z.string().optional(),
    industry: z.string().optional(),
    teamSize: z.string().optional(),
    engagementType: z.string().optional(),
    summary: z.string(),
    problem: z.string().optional(),
    constraints: z.array(z.string()).optional(),
    approach: z.string().optional(),
    outcomes: z
      .array(
        z.object({
          metric: z.string(),
          value: z.string(),
          unit: z.string().optional(),
        })
      )
      .optional(),
    wins: z.array(z.string()).optional(),
    tech: z.array(z.string()).default([]),
    testimonials: z.array(z.string()).optional(),
    // Optional one-line business impact surfaced near the top of the case study
    soWhat: z.string().optional(),
    featured: z.boolean().default(false),
  }),
});

const technologies = defineCollection({
  type: 'data',
  schema: z.object({
    name: z.string(),
    category: z.enum(['framework', 'library', 'platform', 'infra', 'security', 'api', 'runtime', 'database', 'spec']),
    area: z.enum(['frontend', 'backend', 'platform', 'crypto', 'ai', 'testing', 'web3', 'cryptography', 'data', 'auth']),
    group: z.string().optional(),
    icon: z.string().optional(),
    notes: z.string().optional(),
    links: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
    relatedWorkSlugs: z.array(z.string()).default([]),
  }),
});


const competencies = defineCollection({
  type: 'data',
  schema: z.object({
    name: z.string(),
    summary: z.string(),
    bullets: z.array(z.string()).min(3).max(6),
    icon: z.string().optional(),
    relatedWorkSlugs: z.array(z.string()).default([]),
    relatedWritingSlugs: z.array(z.string()).default([]),
    pinned: z.boolean().default(false),
  }),
});

export const collections = { writing, work, technologies, competencies };


