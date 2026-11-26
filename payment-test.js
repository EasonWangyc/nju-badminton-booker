'use strict';

const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { completeFreePayment } = require('./book');

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext();
    const origin = await context.newPage();
    await origin.setContent('<h5 class="module-title" style="display:none">订单信息</h5>');
    const order = await context.newPage();
    await order.setContent(`
      <div class="orderInfo-box">
        <h5 class="module-title">订单信息</h5>
        <div>仙林校区方肇周体育馆羽毛球 2026年11月08日</div>
        <div>8号：18:00-19:00</div>
        <div>请您支付： ¥ <b>0</b> 元</div>
      </div>
      <div class="btn" onclick="document.body.innerHTML='支付成功'"> 支付 <span>（57s）</span> </div>
    `);
    await completeFreePayment(origin, {
      venue: { name: '仙林校区方肇周体育馆' }, court: '8号', time: '18:00-19:00',
    }, '2026-11-08');
    assert.match(await order.locator('body').innerText(), /支付成功/);

    const tradeNo = 'D990101000001';
    const wrongTradeNo = 'D990101000002';
    await context.route('https://ggtypt.nju.edu.cn/venue/orders', route => route.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8',
      body: `<body>${tradeNo} 已支付 正常<br>${wrongTradeNo} 已支付 正常</body>`,
    }));
    const pending = await context.newPage();
    await pending.route('**/venue/venue-reservation/120?tradeNo=*', route => route.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8', body: `
        <h5 class="module-title">订单信息</h5>
        <div>仙林校区方肇周体育馆羽毛球 2026年11月11日</div>
        <div>10号：18:00-19:00</div>
        <div>请您支付： ¥ <b>0</b> 元</div>
        <div class="btn" onclick="document.body.dataset.paid='yes'">支付（57s）</div>
      `,
    }));
    await pending.goto(`https://ggtypt.nju.edu.cn/venue/venue-reservation/120?tradeNo=${tradeNo}`);
    await completeFreePayment(origin, {
      venue: { name: '仙林校区方肇周体育馆' }, court: '10号', time: '18:00-19:00',
    }, '2026-11-11', tradeNo);
    assert.equal(await pending.locator('body').getAttribute('data-paid'), 'yes');

    const wrongOrder = await context.newPage();
    await wrongOrder.route('**/venue/venue-reservation/126?tradeNo=*', route => route.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8', body: `
        <h5 class="module-title">订单信息</h5>
        <div>仙林校区仙林校区方肇周体育馆羽毛球 2026年11月12日</div>
        <div>7号：16:00-17:00</div>
        <div>请您支付： ¥ <b>0</b> 元</div>
        <div class="btn" onclick="document.body.dataset.paid='yes'">支付（40s）</div>
      `,
    }));
    await wrongOrder.goto(`https://ggtypt.nju.edu.cn/venue/venue-reservation/126?tradeNo=${wrongTradeNo}`);
    await assert.rejects(completeFreePayment(origin, {
      venue: { name: '仙林校区四组团体育馆' }, court: '7号', time: '16:00-17:00',
    }, '2026-11-12', wrongTradeNo), /支付页场馆不在允许范围/);
    assert.equal(await wrongOrder.locator('body').getAttribute('data-paid'), null);
    const accepted = await completeFreePayment(origin, {
      venue: { id: 126, name: '仙林校区四组团体育馆' }, court: '7号', time: '16:00-17:00',
    }, '2026-11-12', wrongTradeNo, [
      { id: 126, name: '仙林校区四组团体育馆' },
      { id: 120, name: '仙林校区方肇周体育馆' },
    ]);
    assert.equal(accepted.venue.id, 120);
    assert.equal(await wrongOrder.locator('body').getAttribute('data-paid'), 'yes');
    console.log('零元支付、订单记录、允许场馆及错误场馆拦截测试通过');
  } finally { await browser.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
