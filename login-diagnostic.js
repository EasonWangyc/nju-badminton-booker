'use strict';

// Fresh browser contexts force the full CAS slider flow without touching saved sessions.
const { chromium } = require('playwright-core');
const { loginIfNeeded } = require('./login');
const { openContext, openVenue, VENUES } = require('./book');

const URL = 'https://ggtypt.nju.edu.cn/venue/venue-reservation/126';

function log(account, message) {
  const time = new Date().toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai', hour12: false,
  });
  console.log(`[${time}] ${account} ${message}`);
}

async function checkAccount(browser, account) {
  const context = await browser.newContext({
    locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
    viewport: { width: 1540, height: 900 },
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    if (!page.url().includes('authserver.nju.edu.cn')) {
      throw new Error(`新会话未进入统一认证页面：${page.url()}`);
    }
    const startedAt = Date.now();
    await loginIfNeeded(page, message => log(account, message), account, URL);
    await page.waitForFunction(() =>
      location.hostname === 'ggtypt.nju.edu.cn' &&
      document.body.innerText.includes('欢迎您'),
    undefined, { timeout: 20000 });
    log(account, `全新会话通过滑块并进入场馆网站，用时 ${Date.now() - startedAt}ms。`);
  } finally {
    await context.close();
  }
}

async function main() {
  if (process.argv[2] === '--persistent-primary' || process.argv[2] === '--persistent-secondary') {
    const account = process.argv[2].slice('--persistent-'.length);
    const session = await openContext(account);
    try {
      await openVenue(session.page, VENUES[0], 1, undefined, account);
      log(account, '预约脚本的持久浏览器环境登录成功。');
    } finally {
      await session.context.close();
    }
    return;
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: false });
  try {
    for (const account of ['primary', 'secondary']) {
      await checkAccount(browser, account);
    }
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(`滑块登录诊断失败：${error.message}`);
  process.exitCode = 1;
});
