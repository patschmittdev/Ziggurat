import { mkdir } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const artifacts = fileURLToPath(new URL('../.artifacts/', import.meta.url));
const docsDirectory = fileURLToPath(new URL('../src/content/docs/', import.meta.url));
const docRoutes = readdirSync(docsDirectory, { recursive: true, encoding: 'utf8' })
  .filter(path => /\.(md|mdx)$/.test(path))
  .map(path => path.replaceAll('\\', '/').replace(/\.(md|mdx)$/, '').replace(/(^|\/)index$/, '$1'))
  .map(path => `${path.replace(/\/$/, '')}/`);
const routes = [...new Set(['/', ...docRoutes])].sort();

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

    if (route === '/') {
      await expect(page.locator('.admission__flow > li')).toHaveCount(4);
      await expect(page.locator('#ascent [data-ascent-figure]')).toBeVisible();
      await expect(page.locator('.walkthrough__steps > li')).toHaveCount(7);
      const walkthrough = page.getByRole('link', { name: 'Read the seven-step walkthrough', exact: true });
      await expect(walkthrough).toHaveClass(/action--primary/);
      expect((await walkthrough.boundingBox())?.height).toBeGreaterThanOrEqual(44);

      const layout = await page.evaluate(() => {
        const rect = (element: Element) => element.getBoundingClientRect();
        const bands = [...document.querySelectorAll<HTMLElement>('main > .band')];
        const content = 'h1, h2, h3, p, li, pre, table, figure, figcaption, dt, dd, .action';
        const gaps = bands.map(band => {
          const previous = band.previousElementSibling!;
          const bottoms = [...previous.querySelectorAll(content)]
            .filter(element => rect(element).height > 0)
            .map(element => rect(element).bottom);
          return rect(band.querySelector('h2')!).top - Math.max(...bottoms);
        });
        const columns = ['.thesis', '.split', '.compare', '.walkthrough', '.ledger-pair', '.path', '.status__layout']
          .flatMap(selector => [...document.querySelectorAll(selector)])
          .map(element => rect(element.children[1]!).left);
        return { width: innerWidth, gaps, columnSpread: Math.max(...columns) - Math.min(...columns) };
      });
      expect(Math.max(...layout.gaps), 'Compounded section whitespace').toBeLessThanOrEqual(160);
      if (layout.width >= 1024) {
        expect(layout.columnSpread, 'Desktop second-column alignment').toBeLessThanOrEqual(1);
      }
    } else {
      const wrappers = page.locator('.sl-markdown-content .sl-heading-wrapper.level-h2');
      expect(await wrappers.count()).toBe(await page.locator('.sl-markdown-content h2').count());
      const headingIssues = await wrappers.evaluateAll(elements => elements.flatMap(wrapper => {
        const heading = wrapper.querySelector('h2')!;
        const headingStyle = getComputedStyle(heading);
        const wrapperStyle = getComputedStyle(wrapper);
        const firstSection = wrapper.matches('.sl-markdown-content > .sl-heading-wrapper:first-child');
        const expectedBorder = firstSection ? 0 : 1;
        const box = wrapper.getBoundingClientRect();
        const parent = wrapper.parentElement!;
        const parentBox = parent.getBoundingClientRect();
        const parentStyle = getComputedStyle(parent);
        const contentLeft = parentBox.left + parseFloat(parentStyle.paddingLeft)
          + parseFloat(parentStyle.borderLeftWidth);
        const range = document.createRange();
        range.selectNodeContents(heading);
        const lines = [...range.getClientRects()];
        const problem = parseFloat(headingStyle.borderTopWidth) !== 0
          || parseFloat(headingStyle.paddingTop) !== 0
          || parseFloat(wrapperStyle.borderTopWidth) !== expectedBorder
          || (firstSection ? parseFloat(wrapperStyle.paddingTop) !== 0 : parseFloat(wrapperStyle.paddingTop) < 16)
          || Math.abs(box.left - contentLeft) > 1
          || (!firstSection && lines.some(line => line.top < box.top + 1));
        return problem ? [{
          heading: heading.textContent,
          headingBorder: headingStyle.borderTopWidth,
          headingPadding: headingStyle.paddingTop,
          wrapperBorder: wrapperStyle.borderTopWidth,
          wrapperPadding: wrapperStyle.paddingTop,
        }] : [];
      }));
      expect(headingIssues, `Heading rules must stay above text on ${route}`).toEqual([]);
      const paginationIssues = await page.locator('.pagination-links a').evaluateAll(links =>
        links.filter(link => {
          const style = getComputedStyle(link);
          return style.borderRadius !== '0px' || style.boxShadow !== 'none';
        }).map(link => link.textContent));
      expect(paginationIssues, `Navigation must follow the site theme on ${route}`).toEqual([]);

      const menu = page.getByRole('button', { name: 'Menu', exact: true });
      if (await menu.isVisible()) {
        await menu.focus();
        await page.keyboard.press('Enter');
        await expect(menu).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('body')).toHaveAttribute('data-mobile-menu-expanded', '');
        await page.keyboard.press('Enter');
        await expect(menu).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('body')).not.toHaveAttribute('data-mobile-menu-expanded', '');
        const box = await menu.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
    }

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
