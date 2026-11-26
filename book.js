'use strict';

const path = require('node:path');
const { chromium } = require('playwright-core');
const { solveClickCaptcha } = require('./captcha');
const { loginIfNeeded } = require('./login');
const { restoreSession, saveSession } = require('./session');
const { buddyFor } = require('./machine-config');

const BASE = 'https://ggtypt.nju.edu.cn';
const VENUES = [
  { name: '仙林校区四组团体育馆', id: 126 },
  { name: '仙林校区方肇周体育馆', id: 120 },
];
// The site's notice limits badminton to one one-hour slot per person per day.
const TIMES = [
  '18:00-19:00', '19:00-20:00',
  '16:00-17:00', '17:00-18:00',
];

function parseArgs(argv) {
  const modeFlags = argv.filter(arg => ['--setup', '--check', '--book', '--smoke'].includes(arg));
  if (modeFlags.length !== 1) throw new Error('请选择一个模式：--setup、--check、--book 或 --smoke');
  const dateIndex = argv.indexOf('--date');
  const date = dateIndex >= 0 ? argv[dateIndex + 1] : undefined;
  const accountIndex = argv.indexOf('--account');
  const account = accountIndex >= 0 ? argv[accountIndex + 1] : 'primary';
  if (!['primary', 'secondary'].includes(account)) throw new Error('账号须为 primary 或 secondary');
  if (dateIndex >= 0 && !date) throw new Error('--date 后须填写 YYYY-MM-DD');
  if (modeFlags[0] === '--book' && !date) throw new Error('--book 必须指定 --date YYYY-MM-DD');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式须为 YYYY-MM-DD');
  if (date) {
    const [y, m, d] = date.split('-').map(Number);
    const value = new Date(Date.UTC(y, m - 1, d));
    if (value.getUTCFullYear() !== y || value.getUTCMonth() !== m - 1 || value.getUTCDate() !== d) {
      throw new Error('日期无效');
    }
  }
  return { mode: modeFlags[0], date, account };
}

function chinaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function releaseTime(date) {
  const [y, m, d] = date.split('-').map(Number);
  // 08:00 in China is 00:00 UTC.
  return Date.UTC(y, m - 1, d, 0, 0, 0);
}

function dateLabel(date) {
  const [, month, day] = date.split('-').map(Number);
  return `${month}月${String(day).padStart(2, '0')}日`;
}

function venueUrl(venue) {
  return `${BASE}/venue/venue-reservation/${venue.id}`;
}

async function assertVenuePage(page, venue) {
  const actualPath = new URL(page.url()).pathname;
  const expectedPath = new URL(venueUrl(venue)).pathname;
  if (actualPath !== expectedPath) {
    throw new Error(`页面跳转到其他场馆：目标 ${expectedPath}，实际 ${actualPath}`);
  }
  await page.waitForFunction(name => document.body.innerText.includes(name),
    venue.name, { timeout: 10000 });
  const siteId = await page.evaluate(() => [...document.querySelectorAll('*')]
    .find(element => element.__vue__?.$options?.name === 'reservationStepOne')
    ?.__vue__?.currentSite?.id);
  if (siteId && Number(siteId) !== venue.id) {
    throw new Error(`页面内部场馆 ID 为 ${siteId}，目标为 ${venue.id}`);
  }
}

function log(message) {
  console.log(`[${new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}] ${message}`);
}

async function openContext(account = 'primary') {
  if (!['primary', 'secondary'].includes(account)) throw new Error('未知预约账号');
  const profile = path.join(__dirname, account === 'secondary' ? '.edge-profile-secondary' : '.edge-profile');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge', headless: false, locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai', viewport: { width: 1540, height: 900 },
  });
  // Do not reuse a tab whose in-memory reservation state may belong to another venue.
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await restoreSession(context, log, account);
  return { context, page };
}

async function openVenue(page, venue, maxAttempts = 3, preReleaseDate, account = 'primary') {
  let ready = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.goto(venueUrl(venue), { waitUntil: 'domcontentloaded', timeout: 20000 });
      await loginIfNeeded(page, log, account, venueUrl(venue));
      await assertVenuePage(page, venue);
      if (preReleaseDate && Date.now() < releaseTime(preReleaseDate)) {
        await saveSession(page.context(), log, account);
        log(`${venue.name} 已打开；08:00 后再读取场地日期和状态。`);
        return;
      }
      await page.locator('.date_box > div').first().waitFor({ state: 'visible', timeout: 10000 });
      ready = true;
      break;
    } catch (error) {
      if (error.message.includes('未配置加密登录凭据')) throw error;
      log(`${venue.name} 页面加载第 ${attempt} 次未完成：${error.message.split('\n')[0]}，当前页面 ${page.url()}`);
      if (attempt === maxAttempts) throw new Error(`${venue.name} 页面多次加载失败：${error.message.split('\n')[0]}`);
      await page.waitForTimeout(2500);
    }
  }
  if (!ready) throw new Error(`${venue.name} 页面未就绪`);
  await saveSession(page.context(), log, account);
  await page.locator('.buddy-box').waitFor({ state: 'visible', timeout: 10000 });
}

async function selectDate(page, date, mayRefresh) {
  const label = dateLabel(date);
  for (let attempt = 0; attempt < (mayRefresh ? 6 : 1); attempt++) {
    const options = page.locator('.date_box > div');
    const count = await options.count();
    for (let i = 0; i < count; i++) {
      const option = options.nth(i);
      if ((await option.innerText()).includes(label)) {
        if (!(await option.getAttribute('class') || '').includes('active')) {
          await option.click();
          await page.waitForTimeout(150);
        }
        return true;
      }
    }
    if (attempt < 5 && mayRefresh) {
      await page.waitForTimeout(400);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('.date_box').waitFor({ state: 'visible', timeout: 12000 });
    }
  }
  return false;
}

async function readGrid(page, desiredTimes = TIMES) {
  return page.evaluate(times => {
    const tables = [...document.querySelectorAll('table')];
    const slots = [];
    tables.forEach((table, tableIndex) => {
      if (!table.getClientRects().length) return;
      const rows = [...table.querySelectorAll('tr')];
      const header = rows.find(row => times.some(time => row.textContent.includes(time)));
      if (!header) return;
      const labels = [...header.querySelectorAll('td,th')].slice(1).map(cell => cell.textContent.trim());
      rows.forEach((row, rowIndex) => {
        const cells = [...row.querySelectorAll(':scope > td, :scope > th')];
        if (!cells.length) return;
        const court = cells[0].textContent.trim();
        if (!/^\d+号$/.test(court)) return;
        let column = 0;
        cells.slice(1).forEach((cell, offset) => {
          const span = Math.max(1, Number(cell.getAttribute('colspan')) || 1);
          const block = cell.querySelector('.reserveBlock');
          for (let step = 0; step < span; step++) {
            const time = labels[column + step];
            if (time && times.includes(time)) {
              slots.push({ court, time, status: block?.textContent.trim() || cell.textContent.trim(),
                className: block?.className || '', tableIndex, rowIndex, cellIndex: offset + 1 });
            }
          }
          column += span;
        });
      });
    });
    if (!slots.length) return { error: `未找到目标时段 ${times.join('、')} 的场地表格` };
    return { slots };
  }, desiredTimes);
}

async function waitForGrid(page, desiredTimes = TIMES) {
  await page.waitForFunction(times => [...document.querySelectorAll('table')].some(table =>
    times.some(time => table.innerText.includes(time)) && table.querySelector('.reserveBlock')
  ), desiredTimes, { timeout: 12000 });
}

function free(slot) {
  return slot.status === '空闲' ||
    (/\b(free|available|idle|vacant)\b/i.test(slot.className) && !/已预约|未支付|不开放/.test(slot.status));
}

class SlotUnavailableError extends Error {}

async function refreshAndScan(page, venue, date, maxDurationMs = 180000,
  account = 'primary', desiredTimes = TIMES) {
  const deadline = Date.now() + maxDurationMs;
  let lastError;
  for (let attempt = 1; Date.now() < deadline; attempt++) {
    try {
      await page.goto(venueUrl(venue), { waitUntil: 'domcontentloaded', timeout: 20000 });
      await loginIfNeeded(page, log, account, venueUrl(venue));
      await assertVenuePage(page, venue);
      await page.locator('.date_box > div').first().waitFor({ state: 'visible', timeout: 6000 });
      if (!await selectDate(page, date, false)) throw new Error(`${date} 尚未出现在日期列表`);
      await waitForGrid(page, desiredTimes);
      const grid = await readGrid(page, desiredTimes);
      if (grid.error) throw new Error(grid.error);
      return grid.slots;
    } catch (error) {
      lastError = error;
      if (attempt === 1 || attempt % 3 === 0) {
        log(`${venue.name} 08:00 后第 ${attempt} 次读取未完成：${error.message.split('\n')[0]}`);
      }
      await page.waitForTimeout(600);
    }
  }
  throw new Error(`${venue.name} 场地表在开放后 3 分钟内未加载：${lastError?.message.split('\n')[0]}`);
}

function candidateKey(candidate) {
  return `${candidate.pageIndex}:${candidate.court}:${candidate.time}`;
}

function chooseCandidate(scans, tried = new Set()) {
  // Time preference takes precedence over the two acceptable venues.
  for (const time of TIMES) {
    for (let index = 0; index < VENUES.length; index++) {
      const candidate = scans[index]?.find(slot =>
        slot.time === time && free(slot) &&
        !tried.has(candidateKey({ pageIndex: index, ...slot })));
      if (candidate) return { venue: VENUES[index], pageIndex: index, ...candidate };
    }
  }
  return null;
}

async function waitForRelease(date) {
  if (chinaDate() > date) throw new Error('预约日期已经过去');
  const release = releaseTime(date);
  if (Date.now() >= release) return;
  log(`等待 ${date} 08:00（北京时间）开放预约。请保持电脑唤醒和网络连接。`);
  while (Date.now() < release) {
    const remaining = release - Date.now();
    await new Promise(resolve => setTimeout(resolve, Math.min(remaining, remaining > 60000 ? 30000 : 100)));
  }
}

async function verifyPaidOrder(context, tradeNo) {
  if (!tradeNo) return false;
  const orders = await context.newPage();
  try {
    await orders.goto(`${BASE}/venue/orders`, { waitUntil: 'domcontentloaded', timeout: 12000 });
    for (let attempt = 0; attempt < 12; attempt++) {
      const text = await orders.locator('body').innerText().catch(() => '');
      const index = text.indexOf(tradeNo);
      if (index >= 0) {
        const following = text.slice(index + tradeNo.length);
        const nextOrder = following.search(/D\d{12}/);
        const entry = following.slice(0, nextOrder >= 0 ? nextOrder : 500);
        if (/已支付/.test(entry) && /正常/.test(entry)) return true;
      }
      await orders.waitForTimeout(500);
      if (attempt === 5) await orders.reload({ waitUntil: 'domcontentloaded', timeout: 12000 });
    }
    return false;
  } finally {
    await orders.close();
  }
}

async function completeFreePayment(page, candidate, date, expectedTradeNo,
  allowedVenues = [candidate.venue]) {
  const [year, month, day] = date.split('-').map(Number);
  const shownDate = `${year}年${month}月${String(day).padStart(2, '0')}日`;
  const expected = [shownDate, candidate.court, candidate.time];
  const deadline = Date.now() + 20000;
  let paymentPage;
  let actualVenue;
  while (Date.now() < deadline && !paymentPage) {
    for (const candidatePage of page.context().pages()) {
      if (candidatePage.isClosed()) continue;
      const title = candidatePage.locator('h5.module-title:visible').filter({ hasText: '订单信息' }).first();
      if (!await title.isVisible().catch(() => false)) continue;
      const text = await candidatePage.locator('body').innerText();
      const pageTradeNo = new URL(candidatePage.url()).searchParams.get('tradeNo');
      if (expectedTradeNo && pageTradeNo !== expectedTradeNo) continue;
      const price = text.match(/请您支付\s*[：:]?\s*[¥￥]\s*([\d.]+)\s*元/);
      const matchingVenues = allowedVenues.filter(venue => text.includes(venue.name));
      if (price && Number(price[1]) === 0 && expected.every(value => text.includes(value)) &&
          matchingVenues.length === 1) {
        paymentPage = candidatePage;
        actualVenue = matchingVenues[0];
        break;
      }
      if (price && Number(price[1]) === 0 &&
          expected.every(value => text.includes(value)) && matchingVenues.length !== 1) {
        throw new Error(`订单 ${pageTradeNo || expectedTradeNo || '未知'} 的支付页场馆不在允许范围 ${allowedVenues.map(venue => venue.name).join('、')}：${text.replace(/\s+/g, ' ').slice(-260)}`);
      }
    }
    if (!paymentPage) await page.waitForTimeout(100);
  }
  if (!paymentPage) {
    const tabs = await Promise.all(page.context().pages().map(async tab => ({
      url: tab.url(),
      visibleOrder: await tab.locator('h5.module-title:visible').filter({ hasText: '订单信息' }).count().catch(() => 0),
      visibleText: (await tab.locator('body').innerText().catch(() => '')).slice(-180),
    })));
    throw new Error(`20 秒内未找到信息吻合的零元支付页：${JSON.stringify(tabs)}`);
  }
  const buttons = paymentPage.locator('.btn:visible');
  let pay;
  const visibleButtons = [];
  for (let index = 0; index < await buttons.count(); index++) {
    const button = buttons.nth(index);
    const label = (await button.innerText()).replace(/\s+/g, '');
    visibleButtons.push(label);
    if (/^支付(?:[（(]\d+s[）)])?$/.test(label)) pay = button;
  }
  if (!pay) throw new Error(`零元订单已显示，但找不到支付按钮；可见按钮：${visibleButtons.join('、')}`);
  const tradeNo = expectedTradeNo || new URL(paymentPage.url()).searchParams.get('tradeNo');
  log(`已核对订单为 ${actualVenue.name} ${candidate.court} ${candidate.time}、0 元，点击支付。`);
  await pay.click();
  if (tradeNo) {
    if (await verifyPaidOrder(page.context(), tradeNo)) {
      log(`预约记录确认订单 ${tradeNo} 已支付。`);
      return { tradeNo, venue: actualVenue, court: candidate.court, time: candidate.time };
    }
    throw new Error(`已点击零元支付，但预约记录未确认订单 ${tradeNo} 已支付且状态正常`);
  }
  try {
    await paymentPage.waitForFunction(() => /支付成功|预约成功|已支付/.test(document.body.innerText), undefined, { timeout: 3000 });
    log('网站页面显示支付或预约成功。');
    return { tradeNo, venue: actualVenue, court: candidate.court, time: candidate.time };
  } catch {
    throw new Error('已点击零元支付，但页面未显示明确成功状态且无法取得订单号');
  }
}

async function submitSelection(page, candidate, date, buddyName = buddyFor('primary'),
  allowedVenues = [candidate.venue]) {
  const cell = page.locator('table').nth(candidate.tableIndex).locator('tr').nth(candidate.rowIndex)
    .locator('td,th').nth(candidate.cellIndex);
  const block = cell.locator('.reserveBlock');
  if (!free({ status: (await block.innerText()).trim(), className: await block.getAttribute('class') || '' })) {
    throw new SlotUnavailableError('所选场地刚刚变为不可用，未提交订单');
  }
  try {
    await block.click({ timeout: 3000 });
  } catch (error) {
    // This click only selects a slot; no order has been submitted yet. A page
    // loading overlay can briefly intercept it during the release rush.
    if (error.name === 'TimeoutError') {
      throw new SlotUnavailableError('场地点击被页面加载状态阻挡，重新读取空位');
    }
    throw error;
  }

  const venueState = await page.evaluate(() => {
    const step = [...document.querySelectorAll('*')]
      .find(element => element.__vue__?.$options?.name === 'reservationStepOne')?.__vue__;
    const form = [...document.querySelectorAll('*')]
      .find(element => element.__vue__?.$options?.name === 'ReservationForm')?.__vue__;
    return {
      currentSiteId: step?.currentSite?.id,
      formSiteId: form?.siteParam?.venueSiteId,
      formVenueName: form?.siteParam?.venueName,
    };
  });
  if ((venueState.currentSiteId && Number(venueState.currentSiteId) !== candidate.venue.id) ||
      (venueState.formSiteId && Number(venueState.formSiteId) !== candidate.venue.id) ||
      (venueState.formVenueName && !venueState.formVenueName.includes(candidate.venue.name.replace('仙林校区', '')))) {
    throw new Error(`下单前页面场馆状态与目标不符：${JSON.stringify(venueState)}`);
  }

  const buddy = page.locator('.buddy-row').filter({ hasText: buddyName });
  try { await buddy.waitFor({ state: 'visible', timeout: 5000 }); }
  catch { throw new Error(`${buddyName} 不在同伴列表；请先在同伴管理中添加`); }
  if (await buddy.count() !== 1) throw new Error(`${buddyName} 在同伴列表中出现次数异常`);
  if (!(await buddy.getAttribute('class') || '').includes('active')) await buddy.click();

  const terms = page.locator('label.ivu-checkbox-wrapper').filter({ hasText: '已阅读并同意' });
  if (!(await terms.locator('input[type=checkbox]').isChecked())) await terms.click();

  const amount = (await page.locator('.action p').innerText()).replace(/\s/g, '');
  if (!/¥0(?:\.00)?元/.test(amount)) throw new Error(`金额并非零元，停止提交：${amount}`);
  const submit = page.locator('.action .btn').filter({ hasText: '提交' });
  if ((await submit.getAttribute('class') || '').includes('disab')) {
    throw new Error('提交按钮仍不可用，请在浏览器中检查场地、同伴与预约须知');
  }
  log(`提交 ${candidate.venue.name} ${candidate.court} ${candidate.time}，同伴 ${buddyName}，金额 0 元`);
  const orderResponse = page.waitForResponse(response =>
    response.url().includes('/api/reservation/order/submit'), { timeout: 15000 });
  await submit.click();
  await solveClickCaptcha(page, log);
  let tradeNo;
  try {
    const response = await orderResponse;
    const result = await response.json();
    const code = result.repCode ?? result.code;
    const message = result.repMsg ?? result.msg ?? result.message ?? '';
    log(`订单提交接口：HTTP ${response.status()}，结果 ${code ?? '未提供状态码'}${message ? `，${message}` : ''}`);
    tradeNo = result.tradeNo ?? result.data?.tradeNo ?? result.result?.tradeNo;
    if (tradeNo) log(`订单号：${tradeNo}`);
    if (!tradeNo && (String(code) === '250' || /已被.*预约|更换场地|场地.*不可用/.test(message))) {
      throw new SlotUnavailableError(message || '该场地已被其他人预约');
    }
    if (!tradeNo && code != null && !['0', '200'].includes(String(code))) {
      throw new Error(`服务器未接受预约：${message || `结果 ${code}`}`);
    }
  } catch (error) {
    if (error instanceof SlotUnavailableError || error.message.startsWith('服务器未接受预约')) throw error;
    log(`订单提交接口响应未能完整读取：${error.message.split('\n')[0]}`);
  }
  return completeFreePayment(page, candidate, date, tradeNo, allowedVenues);
}

async function hasPendingPayment(context) {
  for (const tab of context.pages()) {
    if (tab.isClosed()) continue;
    const title = tab.locator('h5.module-title:visible').filter({ hasText: '订单信息' });
    const pay = tab.locator('.btn:visible').filter({ hasText: /^\s*支付/ });
    if (await title.count().catch(() => 0) && await pay.count().catch(() => 0)) return true;
  }
  return false;
}

async function main() {
  const { mode, date, account } = parseArgs(process.argv.slice(2));
  const { context, page } = await openContext(account);
  let bookingSucceeded = false;
  try {
    if (mode === '--smoke') {
      await page.goto(`${BASE}/venue/home`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      log(`Edge 已启动，页面：${await page.title()}`);
      return;
    }
    if (mode === '--setup') {
      await openVenue(page, VENUES[0], 3, undefined, account);
      const buddies = await page.locator('.buddy-row').allInnerTexts();
      if (!buddies.length) throw new Error('预约页没有可选同伴');
      const expectedBuddy = buddyFor(account);
      if (!buddies.some(name => name.includes(expectedBuddy))) {
        throw new Error(`${expectedBuddy} 尚未显示在预约页同伴列表中`);
      }
      log(`${account} 自动登录和同伴检查通过：${buddies.map(name => name.trim()).join('、')}`);
      return;
    }
    await openVenue(page, VENUES[0], mode === '--book' ? 15 : 3, mode === '--book' ? date : undefined, account);
    if (mode === '--check') {
      const selected = date || chinaDate();
      if (!await selectDate(page, selected, false)) {
        log(`${selected} 尚未开放；当前可选日期：${(await page.locator('.date_box').innerText()).replace(/\s+/g, ' ')}`);
        return;
      }
      await waitForGrid(page);
      const grid = await readGrid(page);
      if (grid.error) throw new Error(grid.error);
      const result = grid.slots.filter(slot => TIMES.includes(slot.time) && free(slot));
      log(result.length ? result.map(slot => `${slot.court} ${slot.time}`).join('\n') : '当前场馆优先时段无空闲');
      return;
    }
    const secondPage = await context.newPage();
    secondPage.setDefaultTimeout(5000);
    await openVenue(secondPage, VENUES[1], 15, date, account);
    await waitForRelease(date);
    const pages = [page, secondPage];
    const scans = [null, null];
    const outcomes = [null, null];
    const scanPromises = pages.map((venuePage, index) =>
      refreshAndScan(venuePage, VENUES[index], date, 180000, account)
        .then(slots => ({ index, slots }), error => ({ index, error }))
        .then(outcome => {
          outcomes[index] = outcome;
          scans[index] = outcome.slots || null;
          if (outcome.error) log(`${VENUES[index].name} 检查失败：${outcome.error.message}`);
          return outcome;
        }));
    const first = await Promise.race(scanPromises);
    let candidate = chooseCandidate(scans);
    if (!candidate || candidate.time !== TIMES[0]) {
      if (candidate) {
        await Promise.race([
          scanPromises[1 - first.index],
          new Promise(resolve => setTimeout(() => resolve(null), 2000)),
        ]);
      } else {
        await scanPromises[1 - first.index];
      }
      candidate = chooseCandidate(scans);
    }
    const tried = new Set();
    while (candidate) {
      tried.add(candidateKey(candidate));
      try {
        await submitSelection(pages[candidate.pageIndex], candidate, date, buddyFor(account));
        bookingSucceeded = true;
        return;
      } catch (error) {
        if (!(error instanceof SlotUnavailableError)) throw error;
        log(`${candidate.venue.name} ${candidate.court} ${candidate.time} 已不可用，自动尝试其他场地。`);
        try {
          scans[candidate.pageIndex] = await refreshAndScan(
            pages[candidate.pageIndex], candidate.venue, date, 15000, account);
        } catch (scanError) {
          scans[candidate.pageIndex] = null;
          log(`${candidate.venue.name} 重新读取失败：${scanError.message.split('\n')[0]}`);
        }
        candidate = chooseCandidate(scans, tried);
        if (!candidate && outcomes.some(outcome => !outcome)) {
          await Promise.all(scanPromises);
          candidate = chooseCandidate(scans, tried);
        }
      }
    }
    if (outcomes.every(outcome => outcome?.error)) throw new Error('两个场馆都未能读取预约状态');
    log('两个场馆的优先时段均无可用场地，未提交订单。');
  } finally {
    if (mode === '--book' && !bookingSucceeded && await hasPendingPayment(context).catch(() => false)) {
      log('检测到尚可支付的订单页，保持 Edge 打开至支付窗口结束。');
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline && await hasPendingPayment(context).catch(() => false)) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    await context.close();
  }
}

if (require.main === module) {
  main().catch(error => { console.error(`失败：${error.message}`); process.exitCode = 1; });
}

module.exports = {
  completeFreePayment, openVenue, chooseCandidate, SlotUnavailableError,
  openContext, refreshAndScan, waitForRelease, submitSelection, hasPendingPayment, free, VENUES,
};
