'use strict';

const { readCredential } = require('./credentials');
const { runOcr } = require('./ocr-runner');

function locateGap(background, piece) {
  return runOcr('slider-ocr.py', [], JSON.stringify({ background, piece }));
}

async function dragSlider(page, startX, startY, distance) {
  const timings = { moveMs: 0, waitMs: 0, maxMoveMs: 0, maxWaitMs: 0 };
  async function timedMove(x, y) {
    const startedAt = Date.now();
    await page.mouse.move(x, y);
    const elapsed = Date.now() - startedAt;
    timings.moveMs += elapsed;
    timings.maxMoveMs = Math.max(timings.maxMoveMs, elapsed);
  }
  async function timedWait(ms) {
    const startedAt = Date.now();
    await page.waitForTimeout(ms);
    const elapsed = Date.now() - startedAt;
    timings.waitMs += elapsed;
    timings.maxWaitMs = Math.max(timings.maxWaitMs, elapsed);
  }
  await timedMove(startX, startY);
  await page.mouse.down();
  const steps = 34;
  for (let step = 1; step <= steps; step++) {
    const fraction = step / steps;
    const eased = fraction < 0.5
      ? 2 * fraction * fraction
      : 1 - Math.pow(-2 * fraction + 2, 2) / 2;
    const x = startX + distance * eased;
    const y = startY + Math.sin(step * 0.72) * 1.7 + Math.sin(step * 0.23) * 0.8;
    await timedMove(x, y);
    await timedWait(18 + Math.round(Math.random() * 38));
    if (step === 11 || step === 27) await timedWait(70 + Math.round(Math.random() * 50));
  }
  await timedMove(startX + distance + 1.5, startY + 0.8);
  await timedWait(55);
  await timedMove(startX + distance, startY);
  await timedWait(85);
  await page.mouse.up();
  return timings;
}

async function solveSlider(page, log) {
  async function refresh(previous) {
    await page.locator('#sliderDiv .refreshIcon').click();
    await page.waitForFunction(old =>
      document.querySelector('#captcha-id img[src^="data:"]')?.src !== old,
    previous, { timeout: 10000 });
  }
  const maxAttempts = Number(process.env.NJU_SLIDER_ATTEMPTS) || 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const images = await page.locator('#captcha-id img[src^="data:"]').evaluateAll(els =>
      els.map(el => ({ src: el.src, data: el.src.split(',')[1], width: el.naturalWidth })));
    if (images.length < 2) throw new Error('登录拼图图片未加载');
    const result = locateGap(images[0].data, images[1].data);
    if (!result.agreement) {
      log(`登录拼图 ${attempt}: 两种图像匹配结果不一致，正在换图。`);
      await refresh(images[0].src);
      continue;
    }
    const canvas = await page.locator('#sliderDiv canvas').first().boundingBox();
    const slider = await page.locator('#sliderDiv .slider').boundingBox();
    if (!canvas || !slider) throw new Error('登录拼图滑块不可见');
    const scale = canvas.width / images[0].width;
    const distance = ((result.target_x + result.edge_x) / 2 - images[1].width / 2) * scale;
    if (!Number.isFinite(distance) || distance < 0 || distance > canvas.width) {
      log(`登录拼图第 ${attempt} 次位移估计超出画布，正在换图。`);
      await refresh(images[0].src);
      continue;
    }
    log(`登录拼图第 ${attempt} 次估计位移 ${Math.round(distance)} / 画布 ${Math.round(canvas.width)} 像素。`);
    const startX = slider.x + slider.width / 2;
    const startY = slider.y + slider.height / 2;
    // Attach the rejection handler before moving the slider. A slow or missing
    // response must not become an unhandled rejection while dragSlider awaits.
    let verifyRequested = false;
    let verifyRequestFailed = '';
    const startedAt = Date.now();
    const onRequest = request => {
      if (request.url().includes('/common/verifySliderCaptcha.htl')) {
        verifyRequested = true;
        log(`登录拼图第 ${attempt} 次验证请求在拖动后 ${Date.now() - startedAt}ms 发出。`);
      }
    };
    const onRequestFailed = request => {
      if (request.url().includes('/common/verifySliderCaptcha.htl')) {
        verifyRequestFailed = request.failure()?.errorText || '未知网络错误';
      }
    };
    page.on('request', onRequest);
    page.on('requestfailed', onRequestFailed);
    const verification = page.waitForResponse(response =>
      response.url().includes('/common/verifySliderCaptcha.htl'), { timeout: 45000 })
      .then(async response => {
        log(`登录拼图第 ${attempt} 次验证响应在 ${Date.now() - startedAt}ms 到达，HTTP ${response.status()}。`);
        return Promise.race([
          response.json().then(body => ({ body }), error => ({ error })),
          new Promise(resolve => setTimeout(() => resolve({ error: new Error('验证响应正文等待超过 10 秒') }), 10000)),
        ]);
      }, error => ({ error }));
    try {
      const timings = await dragSlider(page, startX, startY, distance);
      log(`登录拼图第 ${attempt} 次拖动用时 ${Date.now() - startedAt}ms；移动 ${timings.moveMs}ms（最长 ${timings.maxMoveMs}ms），等待 ${timings.waitMs}ms（最长 ${timings.maxWaitMs}ms）。`);
    }
    catch (error) {
      page.off('request', onRequest);
      page.off('requestfailed', onRequestFailed);
      if (!page.url().includes('authserver.nju.edu.cn')) {
        log('统一身份认证已跳转，继续检查预约页。');
        return;
      }
      log(`登录拼图第 ${attempt} 次拖动未完成：${error.message.split('\n')[0]}`);
      await verification;
      await refresh(images[0].src);
      continue;
    }
    const verified = await verification;
    page.off('request', onRequest);
    page.off('requestfailed', onRequestFailed);
    if (verified.error) {
      if (!page.url().includes('authserver.nju.edu.cn')) {
        log('统一身份认证已跳转，继续检查预约页。');
        return;
      }
      log(`登录拼图第 ${attempt} 次验证响应超时或无法读取（${verified.error.message.split('\n')[0]}，用时 ${Date.now() - startedAt}ms）；验证请求${verifyRequested ? '已发送' : '未发送'}${verifyRequestFailed ? `，网络失败：${verifyRequestFailed}` : ''}，正在换图。`);
      await refresh(images[0].src);
      continue;
    }
    const resultBody = verified.body;
    if (resultBody.errorCode === 1) {
      log('统一身份认证拼图已由网站确认通过。');
      await page.waitForURL(url => url.hostname !== 'authserver.nju.edu.cn', { timeout: 20000 });
      return;
    }
    log(`登录拼图第 ${attempt} 次被网站拒绝，准备下一张图片。`);
    try {
      await page.waitForFunction(old =>
        document.querySelector('#captcha-id img[src^="data:"]')?.src !== old,
      images[0].src, { timeout: 5000 });
    } catch { await refresh(images[0].src); }
  }
  throw new Error('统一身份认证拼图多次尝试未通过');
}

async function loginCasIfNeeded(page, log, account) {
  if (!page.url().includes('authserver.nju.edu.cn')) return;
  const credential = readCredential(account);
  if (!credential) throw new Error('未配置加密登录凭据，请运行 save-credential.ps1');
  await page.locator('#username:visible').first().fill(credential.username);
  await page.locator('#password:visible').first().fill(credential.password);
  await page.locator('#login_submit:visible').first().click();
  log('已提交统一身份认证凭据。');
  await page.waitForFunction(() =>
    location.hostname === 'ggtypt.nju.edu.cn' ||
    !!document.querySelector('#sliderDiv .slider')?.getClientRects().length,
  undefined, { timeout: 15000 });
  if (page.url().includes('authserver.nju.edu.cn')) await solveSlider(page, log);
}

async function loginIfNeeded(page, log, account = 'primary', returnUrl) {
  await loginCasIfNeeded(page, log, account);
  if (!page.url().includes('ggtypt.nju.edu.cn')) return;
  await page.waitForFunction(() =>
    /欢迎您|请登录后访问|统一身份认证登录/.test(document.body.innerText),
  undefined, { timeout: 6000 }).catch(() => {});
  let body = await page.locator('body').innerText();
  if (/欢迎您/.test(body.slice(0, 120))) return;
  if (!/请登录后访问|统一身份认证登录/.test(body) && !page.url().includes('/venue/login')) return;

  log('场馆网站尚未建立登录会话，继续完成网站统一认证。');
  if (!page.url().includes('/venue/login')) {
    await page.goto('https://ggtypt.nju.edu.cn/venue/login', {
      waitUntil: 'domcontentloaded', timeout: 20000,
    });
  }
  await loginCasIfNeeded(page, log, account);
  const signIn = page.getByText('统一身份认证登录', { exact: true });
  await signIn.waitFor({ state: 'visible', timeout: 10000 });
  await signIn.click();
  await page.waitForFunction(() =>
    location.hostname === 'ggtypt.nju.edu.cn' && document.body.innerText.includes('欢迎您'),
  undefined, { timeout: 20000 });
  if (returnUrl && page.url() !== returnUrl) {
    await page.goto(returnUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  }
  body = await page.locator('body').innerText();
  if (/请登录后访问/.test(body)) throw new Error('场馆网站完成统一认证后仍提示未登录');
}

module.exports = { loginIfNeeded };
