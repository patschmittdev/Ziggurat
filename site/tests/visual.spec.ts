import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const artifacts = fileURLToPath(new URL('../.artifacts/', import.meta.url));
const routes = ['/', 'getting-started/overview/', 'security/threat-model/', 'reference/cli/'];

for (const route of routes) {
  test(`${route} visual and accessibility`, async ({ page }, testInfo) => {
    // A leading slash would discard the /Ziggurat/ base path.
    await page.goto(route === '/' ? './' : route);
    await page.waitForLoadState('networkidle');

    const widths = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(widths.document, `Horizontal overflow on ${route}`).toBeLessThanOrEqual(widths.viewport);
    await expect(page.locator('h1')).toHaveCount(1);

    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    if (violations.length) console.error(JSON.stringify(violations, null, 2));
    expect(violations, `Axe violations on ${route} (${testInfo.project.name})`).toEqual([]);

    const slug = route === '/' ? 'home' : route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
    const [project, scheme] = testInfo.project.name.split('-');
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({
      path: join(artifacts, `${slug}-${project}-${scheme}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  });
}
