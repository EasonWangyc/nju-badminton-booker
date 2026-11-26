'use strict';

const path = require('node:path');
const { chromium } = require('playwright-core');
const { recognize, solveClickCaptcha } = require('./captcha');
const { loginIfNeeded } = require('./login');

async function main() {
  const context = await chromium.launchPersistentContext(path.join(__dirname, '.edge-profile'), {
    channel: 'msedge', headless: false, locale: 'zh-CN',
    viewport: { width: 1540, height: 900 },
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://ggtypt.nju.edu.cn/venue/venue-reservation/126', { waitUntil: 'domcontentloaded' });
    await loginIfNeeded(page, console.log);
    await page.locator('.date_box').waitFor({ timeout: 30000 });
    const result = await page.evaluate(() => {
      const seen = new Set();
      function search(vm) {
        if (!vm || seen.has(vm)) return null;
        seen.add(vm);
        if (typeof vm.doVerify === 'function' && vm.$refs?.verify) return vm;
        for (const child of vm.$children || []) {
          const found = search(child);
          if (found) return found;
        }
        return null;
      }
      const roots = [...document.querySelectorAll('*')].map(el => el.__vue__).filter(Boolean);
      const vm = roots.map(search).find(Boolean);
      if (!vm) return { found: false, roots: roots.length };
      vm.doVerify(true);
      return { found: true };
    });
    console.log('component', JSON.stringify(result));
    if (!result.found) return;
    for (let index = 0; index < 5; index++) {
      const img = page.locator('.verify-img-panel:visible img').first();
      await img.waitFor({ state: 'visible', timeout: 10000 });
      const prompt = await page.locator('.verify-msg:visible').first().innerText();
      const targets = prompt.match(/【([^】]+)】/)?.[1].split(/[,，、\s]+/).filter(Boolean);
      if (!targets) throw new Error(`提示异常：${prompt}`);
      const image = await img.screenshot();
      require('node:fs').writeFileSync(path.join(__dirname, '.analysis-assets', `captcha-${index + 1}.png`), image);
      const output = recognize(image, targets);
      console.log(index + 1, JSON.stringify({ targets, output }));
      const src = await img.getAttribute('src');
      await page.locator('.verify-img-panel:visible .verify-refresh').first().click();
      await page.waitForFunction(old => document.querySelector('.verify-img-panel img')?.getAttribute('src') !== old, src);
    }
    const callbackReplaced = await page.evaluate(() => {
      const vm = [...document.querySelectorAll('*')].map(el => el.__vue__)
        .find(node => node?.$refs?.verify?.$refs?.instance);
      if (!vm) return false;
      vm.$refs.verify.$refs.instance.success = () => { window.__captchaTestPassed = true; };
      return true;
    });
    if (!callbackReplaced) throw new Error('无法隔离验证码成功回调，跳过点击测试');
    await solveClickCaptcha(page, console.log);
    console.log('captcha server result', await page.evaluate(() => !!window.__captchaTestPassed));
  } finally {
    await context.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
