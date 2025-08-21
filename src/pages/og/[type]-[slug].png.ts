import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { readFile } from 'node:fs/promises';

export async function getStaticPaths() {
  const writing = await getCollection('writing', ({ data }) => !data.hide);
  const work = await getCollection('work');
  return [
    ...writing.map((w) => ({ params: { type: 'writing', slug: w.slug } })),
    ...work.map((w) => ({ params: { type: 'work', slug: w.slug } })),
  ];
}

export async function GET({ params, request }: APIContext) {
  const { type, slug } = params as { type: 'writing' | 'work'; slug: string };
  const url = new URL(request.url);
  const theme = (url.searchParams.get('theme') ?? 'light') as 'light' | 'dark';
  const collection = type === 'writing' ? await getCollection('writing') : await getCollection('work');
  const entry = collection.find((e) => e.slug === slug);
  if (!entry) return new Response('Not found', { status: 404 });
  const title = entry.data.title as string;
  const subtitle = (entry.data.summary as string) || '';
  const palette = theme === 'dark'
    ? {
        base: '#0f0f10',
        fg: '#f3f3f1',
        sub: '#c0c0bf',
        g1: 'rgba(42,111,107,0.12)',
        g2: 'rgba(255,255,255,0.07)', // soft lift on dark
      }
    : {
        base: '#f6f6f3',
        fg: '#0f0f10',
        sub: '#6b6b6b',
        g1: 'rgba(42,111,107,0.10)',
        g2: 'rgba(15,15,16,0.06)', // gentle shade on light
      };

  // Use static TTFs (Regular and SemiBold) instead of the variable font to avoid fvar parsing issues in satori/opentype
  const notoFontRegular = await readFile(new URL('../../../public/fonts/NotoSans-Regular.ttf', import.meta.url));
  const notoFontSemiBold = await readFile(new URL('../../../public/fonts/NotoSans-SemiBold.ttf', import.meta.url));
  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '64px',
          // Soft base color with subtle, baked-in gradients
          background:
            `radial-gradient(1200px 700px at 70% -10%, ${palette.g1}, rgba(0,0,0,0) 60%),\
             radial-gradient(1000px 550px at -10% 20%, ${palette.g2}, rgba(0,0,0,0) 55%)`,
          backgroundColor: palette.base,
          color: palette.fg,
          position: 'relative',
          overflow: 'hidden',
        },
        children: [
          {
            type: 'div',
            props: { style: { fontSize: '54px', fontFamily: 'Noto Sans', lineHeight: 1.1, position: 'relative' }, children: title },
          },
          {
            type: 'div',
            props: { style: { marginTop: '16px', fontSize: '28px', color: palette.sub, position: 'relative' }, children: subtitle },
          },
          {
            type: 'div',
            props: { style: { position: 'absolute', bottom: '32px', left: '64px', fontSize: '22px' }, children: 'keyrxng.xyz' },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'Noto Sans', data: notoFontRegular, weight: 400, style: 'normal' },
        { name: 'Noto Sans', data: notoFontSemiBold, weight: 600, style: 'normal' },
      ],
    }
  );

  const resvg = new Resvg(svg);
  const png = resvg.render().asPng();
  // Ensure body is a Uint8Array (Buffer is a subclass but TS types for Response may complain)
  return new Response(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' },
  });
}


