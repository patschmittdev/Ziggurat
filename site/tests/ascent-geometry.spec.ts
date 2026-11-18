import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.use({ javaScriptEnabled: false });

test('ascent geometry and labels share the admission axis', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.evaluate(() => document.fonts.ready);
  const figure = page.locator('[data-ascent-figure]');
  await expect(figure).toBeVisible();

  const geometry = await figure.evaluate((element: SVGSVGElement) => {
    const box = (node: SVGGraphicsElement) => {
      const { x, y, width, height } = node.getBBox();
      const style = getComputedStyle(node);
      return {
        x, y, width, height,
        right: x + width,
        bottom: y + height,
        centerX: x + width / 2,
        centerY: y + height / 2,
        stroke: style.stroke === 'none' ? 0 : parseFloat(style.strokeWidth),
      };
    };
    const get = <T extends SVGGraphicsElement>(selector: string) => {
      const node = element.querySelector<T>(selector);
      if (!node) throw new Error(`Missing ascent geometry: ${selector}`);
      return node;
    };
    const path = (selector: string) => {
      const node = get<SVGPathElement>(selector);
      const start = node.getPointAtLength(0);
      const end = node.getPointAtLength(node.getTotalLength());
      return { ...box(node), start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
    };
    const levelBox = (level: number) => box(get(`[data-lvl="${level}"] rect:not(.focus-ring)`));
    const key = get<SVGCircleElement>('[data-lvl="4"] circle');
    const labels = [...element.querySelectorAll<SVGTextElement>('text')].map(node => ({
      text: node.textContent,
      ...box(node),
      fontSize: parseFloat(getComputedStyle(node).fontSize),
    }));
    // The site's declared Arial fallback has wider capitals than Windows system-ui.
    const fallbackLabels = [...element.querySelectorAll<SVGTextElement>('[data-lvl="3"] .fill-refuse')]
      .map(node => {
        const originalFont = node.style.fontFamily;
        try {
          node.style.fontFamily = 'Arial, sans-serif';
          return { text: `${node.textContent} (Arial fallback)`, ...box(node) };
        } finally {
          node.style.fontFamily = originalFont;
        }
      });
    return {
      viewBox: { width: element.viewBox.baseVal.width, height: element.viewBox.baseVal.height },
      renderedWidth: element.getBoundingClientRect().width,
      tiers: [0, 1, 2, 5, 6].map(levelBox),
      pane: box(get(':scope > rect')),
      lips: [...element.querySelectorAll<SVGPathElement>(':scope > g.fig-rule path')].map(box),
      rails: [...element.querySelectorAll<SVGPathElement>(':scope > g.fig-hair path')].map(box),
      base: path(':scope > path.fig-rule'),
      cursor: path('.datum-cursor path[stroke]'),
      arrows: [0, 1, 5].map(level => path(`[data-lvl="${level}"] .fig-stroke-ink`)),
      stop: path('[data-lvl="2"] .fig-stroke-ink'),
      refusal: [...element.querySelectorAll<SVGRectElement>('[data-lvl="3"] rect:not(.focus-ring)')].map(box),
      connector: path('[data-lvl="3"] path:not(.fig-rule)'),
      refusalFocus: box(get('[data-lvl="3"] .focus-ring')),
      key: { ...box(key), cx: key.cx.baseVal.value, cy: key.cy.baseVal.value, radius: key.r.baseVal.value },
      shaft: path('[data-lvl="4"] path:not(.fig-rule)'),
      keyFocus: box(get('[data-lvl="4"] .focus-ring')),
      tierFocus: [0, 1, 2, 5, 6].map(level => box(get(`[data-lvl="${level}"] .focus-ring`))),
      labels,
      fallbackLabels,
    };
  });

  const measurements = testInfo.outputPath('ascent-geometry.json');
  await writeFile(measurements, JSON.stringify(geometry, null, 2));
  await testInfo.attach('ascent-geometry', {
    path: measurements,
    contentType: 'application/json',
  });
  await figure.screenshot({
    path: testInfo.outputPath(`ascent-${testInfo.project.name}.png`),
    animations: 'disabled',
  });

  const axis = geometry.tiers[0]!.centerX;
  expect(axis).toBe(236);
  expect(geometry.tiers.map(({ width, height }) => [width, height])).toEqual([
    [160, 88], [260, 52], [196, 52], [132, 52], [48, 20],
  ]);
  for (const box of [...geometry.tiers, ...geometry.tierFocus, geometry.pane, ...geometry.lips]) {
    expect.soft(box.centerX, 'Tier, focus ring and authorization pane axis').toBe(axis);
  }
  expect.soft(geometry.key.cx, 'External key axis').toBe(axis);
  for (const arrow of geometry.arrows) {
    expect.soft(arrow.start.x).toBe(axis);
    expect.soft(arrow.end.x).toBe(axis);
  }
  expect.soft(geometry.stop.centerX).toBe(axis);

  const [leftRail, rightRail] = geometry.rails;
  expect.soft((leftRail!.x + rightRail!.x) / 2, 'Plate frame axis').toBe(axis);
  expect.soft(geometry.base.start.x).toBe(leftRail!.x);
  expect.soft(geometry.base.end.x).toBe(rightRail!.x);
  expect.soft(geometry.cursor.end.x).toBe(rightRail!.x);
  for (const lip of geometry.lips) {
    expect.soft(lip.x).toBe(geometry.pane.x);
    expect.soft(lip.right).toBe(geometry.pane.right);
  }
  expect.soft(geometry.lips.map(lip => lip.y)).toEqual([geometry.pane.y, geometry.pane.bottom]);

  const [source, stamp] = geometry.refusal;
  const leftPadding = source!.x - source!.stroke / 2 - geometry.pane.x;
  const rightPadding = geometry.pane.right - stamp!.right - stamp!.stroke / 2;
  expect.soft(leftPadding, 'Refusal row left padding').toBeGreaterThanOrEqual(12);
  expect.soft(rightPadding, 'Refusal row right padding').toBeGreaterThanOrEqual(12);
  expect.soft(Math.abs(leftPadding - rightPadding), 'Balanced painted refusal row').toBeLessThanOrEqual(0.5);
  expect.soft(geometry.refusalFocus.centerX).toBe(axis);
  expect.soft(geometry.refusalFocus.x).toBeGreaterThan(geometry.pane.x);
  expect.soft(geometry.refusalFocus.right).toBeLessThan(geometry.pane.right);
  expect.soft(geometry.refusalFocus.y).toBeGreaterThan(geometry.pane.y);
  expect.soft(geometry.refusalFocus.bottom).toBeLessThan(geometry.pane.bottom);
  for (const box of geometry.refusal) {
    expect.soft(box.y - box.stroke / 2).toBeGreaterThan(geometry.refusalFocus.y);
    expect.soft(box.bottom + box.stroke / 2).toBeLessThan(geometry.refusalFocus.bottom);
  }
  expect.soft(geometry.connector.start).toEqual({ x: source!.right, y: source!.centerY });
  expect.soft(geometry.connector.end).toEqual({ x: stamp!.x, y: stamp!.centerY });
  expect.soft(source!.y).toBe(stamp!.y);
  expect.soft(source!.height).toBe(stamp!.height);

  expect.soft(geometry.shaft.end).toEqual({
    x: geometry.key.cx + geometry.key.radius,
    y: geometry.key.cy,
  });
  expect.soft(geometry.shaft.start.y).toBe(geometry.key.cy);
  expect.soft(geometry.shaft.start.x, 'Signing capability originates outside the frame').toBeGreaterThan(rightRail!.x);
  expect.soft(geometry.shaft.start.x).toBeLessThan(geometry.viewBox.width);
  expect.soft(geometry.key.x - geometry.key.stroke / 2).toBeGreaterThan(geometry.keyFocus.x);
  expect.soft(geometry.key.right + geometry.key.stroke / 2).toBeLessThan(geometry.keyFocus.right);
  expect.soft(geometry.key.y - geometry.key.stroke / 2).toBeGreaterThan(geometry.keyFocus.y);
  expect.soft(geometry.key.bottom + geometry.key.stroke / 2).toBeLessThan(geometry.keyFocus.bottom);

  const label = (text: string) => {
    const result = geometry.labels.find(item => item.text === text);
    expect(result, `Missing diagram label: ${text}`).toBeDefined();
    return result!;
  };
  for (const text of geometry.labels) {
    expect.soft(text.x, `${text.text} left bound`).toBeGreaterThanOrEqual(0);
    expect.soft(text.right, `${text.text} right bound`).toBeLessThanOrEqual(geometry.viewBox.width);
    expect.soft(text.y, `${text.text} top bound`).toBeGreaterThanOrEqual(0);
    expect.soft(text.bottom, `${text.text} bottom bound`).toBeLessThanOrEqual(geometry.viewBox.height);
  }
  for (const [text, container] of [
    [label('reviewed_by: alice'), source!],
    [label('REFUSED'), stamp!],
    [geometry.fallbackLabels[0]!, source!],
    [geometry.fallbackLabels[1]!, stamp!],
    [label('BRONZE'), geometry.tiers[1]!],
    [label('preserved'), geometry.tiers[1]!],
    [label('SILVER'), geometry.tiers[2]!],
    [label('proposed'), geometry.tiers[2]!],
    [label('GOLD'), geometry.tiers[3]!],
  ] as const) {
    expect.soft(text.x - container.x - container.stroke / 2, `${text.text} left inset`).toBeGreaterThanOrEqual(6);
    expect.soft(container.right - container.stroke / 2 - text.right, `${text.text} right inset`).toBeGreaterThanOrEqual(6);
    expect.soft(text.y, `${text.text} top inset`).toBeGreaterThan(container.y + container.stroke / 2);
    expect.soft(text.bottom, `${text.text} bottom inset`).toBeLessThan(container.bottom - container.stroke / 2);
  }
  for (const text of [label('external key'), label('outside the vault')]) {
    expect.soft(text.x).toBeGreaterThan(geometry.key.right + geometry.key.stroke / 2);
    expect.soft(text.right, `${text.text} frame bound`).toBeLessThan(rightRail!.x);
    expect.soft(text.y, `${text.text} pane bound`).toBeGreaterThan(geometry.pane.y);
    expect.soft(text.bottom, `${text.text} refusal clearance`).toBeLessThan(source!.y);
    expect.soft(text.x).toBeGreaterThan(geometry.keyFocus.x);
    expect.soft(text.right).toBeLessThan(geometry.keyFocus.right);
    expect.soft(text.y).toBeGreaterThan(geometry.keyFocus.y);
    expect.soft(text.bottom).toBeLessThan(geometry.keyFocus.bottom);
  }
  expect.soft(label('external key').bottom).toBeLessThan(geometry.shaft.y - geometry.shaft.stroke / 2);
  expect.soft(label('outside the vault').y).toBeGreaterThan(geometry.shaft.y + geometry.shaft.stroke / 2);
  expect.soft(label('model reach ends').right).toBeLessThan(rightRail!.x);
  expect.soft(label('SILVER').right + 6, 'Silver label separation').toBeLessThan(label('proposed').x);
  expect.soft(label('BRONZE').right + 6, 'Bronze label separation').toBeLessThan(label('preserved').x);
  expect.soft(label('REFUSED').fontSize).toBe(testInfo.project.use.viewport!.width <= 640 ? 16 : 13);
});
