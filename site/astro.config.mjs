// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const repository = 'https://github.com/patschmittdev/Ziggurat';

export default defineConfig({
  // Repository-scoped GitHub Pages: https://patschmittdev.github.io/Ziggurat/
  site: 'https://patschmittdev.github.io',
  base: '/Ziggurat',
  trailingSlash: 'ignore',
  integrations: [
    starlight({
      title: 'Ziggurat',
      description:
        'A human-gated memory firewall. The refine host persists model-originated Silver JSON; Gold requires authorization from a configured external Ed25519 key.',
      logo: {
        light: './src/assets/ziggurat-mark-light.svg',
        dark: './src/assets/ziggurat-mark-dark.svg',
        alt: '',
      },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: repository }],
      customCss: ['./src/styles/tokens.css', './src/styles/starlight.css'],
      editLink: { baseUrl: `${repository}/edit/main/site/` },
      lastUpdated: false,
      pagination: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      head: [
        { tag: 'meta', attrs: { name: 'color-scheme', content: 'dark light' } },
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content: 'https://patschmittdev.github.io/Ziggurat/social-preview.png',
          },
        },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
      ],
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { slug: 'getting-started/overview' },
            { slug: 'getting-started/installation' },
            { slug: 'getting-started/first-vault' },
            { slug: 'getting-started/garden-walkthrough' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { slug: 'concepts/human-authority-boundary' },
            { slug: 'concepts/tiers' },
            { slug: 'concepts/provenance-and-authority' },
            { slug: 'concepts/isolated-indexes' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { slug: 'guides/ingest-and-refine' },
            { slug: 'guides/human-review-and-authorization' },
            { slug: 'guides/mcp-gold' },
            { slug: 'guides/integrity-and-recovery' },
          ],
        },
        {
          label: 'Security',
          items: [
            { slug: 'security/threat-model' },
            { slug: 'security/attack-controls' },
            { slug: 'security/guarantees' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { slug: 'reference/cli' },
            { slug: 'reference/configuration' },
            { slug: 'reference/authorization-protocol' },
          ],
        },
        {
          label: 'Project',
          items: [
            { slug: 'project/status' },
            { slug: 'project/contributing' },
            { slug: 'project/support' },
            { slug: 'project/policies' },
          ],
        },
      ],
    }),
  ],
});
