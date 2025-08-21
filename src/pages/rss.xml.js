import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const site = 'https://keyrxng.xyz';
  const posts = (await getCollection('writing', ({ data }) => !data.hide))
    .sort((a, b) => new Date(b.data.publishedAt).getTime() - new Date(a.data.publishedAt).getTime())
    .slice(0, 50);
  return rss({
    title: 'Keyrxng — Writing',
    description: 'Field notes, architectural patterns, reliability, testing, context shaping, and pragmatic post-mortems.',
    site,
    xmlns: { atom: 'http://www.w3.org/2005/Atom' },
    customData: `<atom:link href="${site}/rss.xml" rel="self" type="application/rss+xml" />`,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.summary,
      link: `/writing/${post.slug}/`,
      pubDate: new Date(post.data.publishedAt),
      customData: (post.data.tags && post.data.tags.length) ? post.data.tags.map((t) => `<category>${t}</category>`).join('') : undefined,
    })),
  });
}


