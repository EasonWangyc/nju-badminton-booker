'use strict';

const { runOcr } = require('./ocr-runner');

function recognize(image, targets) {
  return runOcr('captcha-ocr.py', [JSON.stringify(targets)], image);
}

async function waitForImage(page) {
  const image = page.locator('.verify-img-panel:visible img').first();
  await image.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => {
    const image = document.querySelector('.verify-img-panel img');
    return image?.complete && image.naturalWidth > 0;
  }, undefined, { timeout: 10000 });
  return image;
}

async function refresh(page, previousSrc) {
  await page.locator('.verify-img-panel:visible .verify-refresh').first().click();
  await page.waitForFunction(src => {
    const image = document.querySelector('.verify-img-panel img');
    return image?.complete && image.getAttribute('src') !== src;
  }, previousSrc, { timeout: 10000 });
}

async function solveClickCaptcha(page, log) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const image = await waitForImage(page);
    const previousSrc = await image.getAttribute('src');
    const prompt = await page.locator('.verify-msg:visible').first().innerText();
    const match = prompt.match(/【([^】]+)】/);
    if (!match) throw new Error(`无法读取验证码提示：${prompt}`);
    const targets = match[1].split(/[,，、\s]+/).filter(Boolean);
    if (targets.length !== 3 || targets.some(item => [...item].length !== 1)) {
      throw new Error(`验证码目标字符异常：${prompt}`);
    }
    const result = recognize(await image.screenshot(), targets);
    if (!result.ok) {
      log(`验证码第 ${attempt} 张图片无法可靠识别，正在刷新。`);
      await refresh(page, previousSrc);
      continue;
    }
    const status = page.locator('.verify-msg:visible').first();
    for (const point of result.points) {
      await image.click({ position: { x: point.x, y: point.y } });
    }
    await page.waitForFunction(() => {
      const text = [...document.querySelectorAll('.verify-msg')]
        .filter(el => el.getClientRects().length).map(el => el.textContent).join(' ');
      return /验证成功|验证失败/.test(text);
    }, undefined, { timeout: 10000 });
    const finalText = await status.innerText();
    if (finalText.includes('验证成功')) {
      log('网站已确认点字验证成功。');
      return;
    }
    log(`验证码第 ${attempt} 次点选未通过，正在重试。`);
    await page.waitForFunction(src => {
      const image = document.querySelector('.verify-img-panel img');
      return image?.complete && image.getAttribute('src') !== src;
    }, previousSrc, { timeout: 10000 });
  }
  throw new Error('五次验证码尝试均未通过，未完成预约');
}

module.exports = { solveClickCaptcha, recognize };
