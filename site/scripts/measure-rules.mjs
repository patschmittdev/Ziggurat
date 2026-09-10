import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// Start scripts/serve-dist.mjs after building the site, then run this script.
const url = 'http://127.0.0.1:4329/Ziggurat/';
const browser = await chromium.launch();
let failures = 0;

try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({
      viewport,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      deviceScaleFactor: 1,
    });
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);

    const measurements = await page.evaluate(() => {
      const rect = (element) => element.getBoundingClientRect();
      const visible = (element) => rect(element).width > 0 && rect(element).height > 0;
      const label = (element) => element.id ? `#${element.id}` : element.tagName.toLowerCase();
      const bands = [...document.querySelectorAll('main > .band')];
      const rules = [];

      // Pseudo-elements have no DOM getBoundingClientRect API. Temporarily replace
      // each with a block carrying its computed styles, measure that block, and
      // restore the original before measuring any other geometry.
      function beforeRect(owner) {
        const computed = getComputedStyle(owner, '::before');
        if (computed.display === 'none' || ['none', 'normal'].includes(computed.content)) return null;
        const probe = document.createElement('span');
        for (const property of computed) {
          probe.style.setProperty(property, computed.getPropertyValue(property));
        }
        const suppress = document.createElement('style');
        suppress.textContent = '[data-measure-rule]::before { display: none !important; }';
        owner.setAttribute('data-measure-rule', '');
        document.head.append(suppress);
        owner.prepend(probe);
        try {
          return rect(probe).toJSON();
        } finally {
          probe.remove();
          suppress.remove();
          owner.removeAttribute('data-measure-rule');
        }
      }

      function addRule(name, ruleRect, neighbour) {
        if (!neighbour) throw new Error(`No neighbouring h2/p for ${name}`);
        rules.push({
          name,
          left: ruleRect.left,
          neighbour: label(neighbour),
          neighbourLeft: rect(neighbour).left,
          delta: Math.abs(ruleRect.left - rect(neighbour).left),
        });
      }

      for (const band of bands) {
        const heading = band.querySelector('h2');
        const before = beforeRect(band);
        if (before) addRule(`.band::before (${label(heading)})`, before, heading);
        else if (parseFloat(getComputedStyle(band).borderTopWidth) > 0) {
          addRule(`.band border-top (${label(heading)})`, rect(band), heading);
        } else if (!band.matches('.band--flush')) {
          throw new Error(`Missing band rule for ${label(heading)}`);
        }
      }

      const footer = document.querySelector('.site-footer');
      const footerWrap = footer.querySelector(':scope > .wrap');
      const footerBefore = beforeRect(footerWrap);
      if (footerBefore) addRule('.site-footer > .wrap::before', footerBefore, footer.querySelector('p'));
      else if (parseFloat(getComputedStyle(footer).borderTopWidth) > 0) {
        addRule('.site-footer border-top', rect(footer), footer.querySelector('p'));
      } else throw new Error('Missing footer rule');

      // The title block has the thesis section's closing border in the incumbent layout.
      const titleblock = document.querySelector('.titleblock');
      if (parseFloat(getComputedStyle(titleblock).borderBottomWidth) > 0) {
        addRule('.titleblock border-bottom (thesis closing rule)', rect(titleblock), document.querySelector('.thesis p'));
      }
      const hrs = [...document.querySelectorAll('hr')].filter(visible);
      for (const [index, hr] of hrs.entries()) {
        let parent = hr.parentElement;
        let neighbours = [];
        while (parent && neighbours.length === 0) {
          neighbours = [...parent.querySelectorAll('h2, p')].filter(visible);
          parent = parent.parentElement;
        }
        neighbours.sort((a, b) => Math.abs(rect(a).top - rect(hr).top) - Math.abs(rect(b).top - rect(hr).top));
        addRule(`hr[${index}]`, rect(hr), neighbours[0]);
      }

      const gaps = bands.map((band) => {
        const previous = band.previousElementSibling;
        const content = [...previous.querySelectorAll('h1, h2, h3, p, li, pre, table, figcaption, dt, dd, .action')].filter(visible);
        if (!content.length) throw new Error('No content at band boundary');
        const last = content.reduce((a, b) => rect(a).bottom > rect(b).bottom ? a : b);
        const heading = band.querySelector('h2');
        return {
          from: previous.getAttribute('aria-labelledby'),
          to: heading.id,
          last: label(last),
          bottom: rect(last).bottom,
          headingTop: rect(heading).top,
          gap: rect(heading).top - rect(last).bottom,
        };
      });
      const buttons = [...document.querySelectorAll('[aria-labelledby="status-title"] .action')].map((button) => ({
        text: button.textContent.trim(),
        height: rect(button).height,
        border: getComputedStyle(button).borderTopColor,
      }));
      return { rules, gaps, buttons, hrCount: hrs.length, height: document.documentElement.scrollHeight };
    });

    const px = (value) => `${value.toFixed(2)}px`;
    console.log(`Viewport ${viewport.width}x${viewport.height}; dark; reduced motion; scale 1`);
    for (const rule of measurements.rules) {
      const pass = rule.delta <= 1;
      console.log(`RULE ${rule.name}: left=${px(rule.left)}; ${rule.neighbour} left=${px(rule.neighbourLeft)}; delta=${px(rule.delta)}; ${pass ? 'PASS' : 'FAIL'}`);
      try { assert.ok(pass, rule.name); } catch { failures += 1; }
    }
    console.log(`Visible hr elements: ${measurements.hrCount}`);
    for (const gap of measurements.gaps) {
      console.log(`GAP ${gap.from} -> ${gap.to}: last=${gap.last}; bottom=${px(gap.bottom)}; h2 top=${px(gap.headingTop)}; gap=${px(gap.gap)}`);
    }
    for (const button of measurements.buttons) {
      console.log(`BUTTON ${button.text}: height=${px(button.height)}; border=${button.border}`);
    }
    console.log(`document.documentElement.scrollHeight: ${measurements.height}px`);
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`Rule alignment: ${failures === 0 ? 'PASS' : 'FAIL'} (${failures} outside 1px tolerance)`);
process.exitCode = failures === 0 ? 0 : 1;
