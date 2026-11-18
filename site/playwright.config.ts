import { defineConfig } from '@playwright/test';

const port = process.env.PORT ?? '4329';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error('PORT must be a decimal integer between 1 and 65535.');
}
const baseURL = `http://127.0.0.1:${Number(port)}/Ziggurat/`;
const sizes = [
  { name: 'desktop', viewport: { width: 1280, height: 900 } },
  { name: 'tablet', viewport: { width: 834, height: 1112 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
];
const schemes = ['light', 'dark'] as const;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  timeout: 60_000,
  reporter: 'list',
  outputDir: './.artifacts/test-results',
  use: {
    baseURL,
    browserName: 'chromium',
    // Keep below-fold reveal content visible for the audit and full-page capture.
    reducedMotion: 'reduce',
  },
  projects: sizes.flatMap(({ name, viewport }) =>
    schemes.map((colorScheme) => ({
      name: `${name}-${colorScheme}`,
      use: { viewport, colorScheme },
    })),
  ),
  webServer: {
    command: 'npm run build && node scripts/serve-dist.mjs',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
