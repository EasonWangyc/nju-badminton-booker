'use strict';

const {
  openContext, openVenue, refreshAndScan, waitForRelease,
  submitSelection, hasPendingPayment, free, SlotUnavailableError, VENUES,
} = require('./book');
const { loadPairTarget, DEFAULT_TIMES, consecutivePairs, adjacentTimes } = require('./booking-config');
const { buddyFor } = require('./machine-config');

const TIMES = DEFAULT_TIMES;
const ACCOUNT_IDS = ['primary', 'secondary'];
class NoAvailableSlotError extends Error {}

function log(message) {
  const time = new Date().toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai', hour12: false,
  });
  console.log(`[${time}] ${message}`);
}

function slotKey(candidate) {
  return `${candidate.venue.id}:${candidate.court}:${candidate.time}`;
}

function chooseCandidate(scans, excluded = new Set(), venueOrder, venues = VENUES, times = TIMES) {
  const order = venueOrder || venues.map((_, index) => index);
  for (const time of times) {
    for (const index of order) {
      const venue = venues[index];
      const slot = scans[index]?.find(item => item.time === time && free(item) &&
        !excluded.has(slotKey({ venue, ...item })));
      if (slot) return { venue, pageIndex: index, ...slot };
    }
  }
  return null;
}

function chooseCoordinatedPair(scansByAccount, venues, times, claimed = new Set(), excluded = new Set()) {
  for (const pair of consecutivePairs(times)) {
    if (excluded.has(pair.join('|'))) continue;
    for (const assignment of [pair, [pair[1], pair[0]]]) {
      if (scansByAccount.every((scans, index) =>
        chooseCandidate(scans, claimed, undefined, venues, [assignment[index]]))) {
        return assignment;
      }
    }
  }
  return null;
}

async function prepareAccount(config, date, sessions, venues, maxAttempts) {
  const session = await openContext(config.id);
  sessions.set(config.id, session);
  // Keep the tab doing CAS slider verification active. Background tabs make
  // mouse.move take about a second per step and the site rejects the drag.
  const pages = venues.map((_, index) => index === 0 ? session.page : null);
  for (let index = 0; index < venues.length; index++) {
    if (index > 0) pages[index] = await session.context.newPage();
    pages[index].setDefaultTimeout(5000);
    try {
      await pages[index].bringToFront();
      await openVenue(pages[index], venues[index], maxAttempts, date, config.id);
      const body = await pages[index].locator('body').innerText();
      if (!body.includes('欢迎您')) throw new Error('场馆网站未确认登录');
      log(`${config.id} 已打开 ${venues[index].name}。`);
    } catch (error) {
      log(`${config.id} 打开 ${venues[index].name} 失败：${error.message}`);
      pages[index] = null;
    }
  }
  if (pages.every(page => !page)) throw new Error(`${config.id} 所选场馆均未就绪`);
  return { config, context: session.context, pages, scans: venues.map(() => null), paid: false };
}

async function scanVenue(state, index, date, maxDurationMs, venues, times) {
  try {
    const slots = await refreshAndScan(state.pages[index], venues[index], date,
      maxDurationMs, state.config.id, times);
    state.scans[index] = slots;
    const counts = times.map(time => `${time} ${slots.filter(slot => slot.time === time && free(slot)).length}`);
    log(`${state.config.id} ${venues[index].name} 空闲数：${counts.join('；')}`);
    return { index, slots };
  } catch (error) {
    state.scans[index] = null;
    log(`${state.config.id} 读取 ${venues[index].name} 失败：${error.message}`);
    return { index, error };
  }
}

async function bookForAccount(state, date, claimed, venues, times,
  { skipInitialScan = false, maxDurationMs = 180000 } = {}) {
  // Spread the two accounts across the equally acceptable gyms at release.
  const venueOrder = venues.map((_, index) => index);
  if (state.config.id === 'secondary' && venueOrder.length > 1) venueOrder.reverse();
  if (!skipInitialScan) {
    const scanJobs = state.pages.map((page, index) =>
      page ? scanVenue(state, index, date, 45000, venues, times) : null);
    const jobs = scanJobs.filter(Boolean);
    if (!jobs.length) throw new Error(`${state.config.id} 没有可读取的场馆`);
    await Promise.race(jobs);
    if (state.scans[venueOrder[0]] === null && scanJobs[venueOrder[0]]) {
      await Promise.race([scanJobs[venueOrder[0]], new Promise(resolve => setTimeout(resolve, 800))]);
    }
    const firstCandidate = chooseCandidate(state.scans, claimed, venueOrder, venues, times);
    if (!firstCandidate || firstCandidate.time !== times[0]) {
      if (firstCandidate) {
        await Promise.race([Promise.all(jobs), new Promise(resolve => setTimeout(resolve, 800))]);
      } else {
        await Promise.all(jobs);
      }
    }
  }

  const deadline = Date.now() + maxDurationMs;
  let rescanned = false;
  while (Date.now() < deadline) {
    const candidate = chooseCandidate(state.scans, claimed, venueOrder, venues, times);
    if (!candidate) {
      if (!rescanned) {
        rescanned = true;
        await Promise.all(state.pages.map((page, index) =>
          page ? scanVenue(state, index, date, 12000, venues, times) : null));
        continue;
      }
      throw new NoAvailableSlotError(`${state.config.id} 所选场馆的目标时段均无可用场地`);
    }
    const key = slotKey(candidate);
    claimed.add(key);
    log(`${state.config.id} 尝试 ${candidate.venue.name} ${candidate.court} ${candidate.time}。`);
    try {
      const result = await submitSelection(state.pages[candidate.pageIndex], candidate,
        date, state.config.buddy, venues);
      state.paid = true;
      state.order = result;
      claimed.add(slotKey(result));
      log(`${state.config.id} 已支付 ${result.venue.name} ${result.court} ${result.time}，订单 ${result.tradeNo || '未知'}。`);
      return;
    } catch (error) {
      if (!(error instanceof SlotUnavailableError)) throw error;
      log(`${state.config.id} ${error.message}，继续尝试其他空位。`);
      venueOrder.reverse();
      await Promise.all(state.pages.map((page, index) =>
        page ? scanVenue(state, index, date, 15000, venues, times) : null));
    }
  }
  throw new NoAvailableSlotError(`${state.config.id} 在指定时间内未抢到目标时段`);
}

async function scanForAccounts(states, date, venues, times) {
  await Promise.all(states.flatMap(state => state.pages.map((page, index) =>
    page ? scanVenue(state, index, date, 12000, venues, times) : null).filter(Boolean)));
}

async function bookCoordinated(ready, date, claimed, venues, times) {
  const deadline = Date.now() + 180000;
  const excludedPairs = new Set();
  await scanForAccounts(ready, date, venues, times);
  while (Date.now() < deadline) {
    let assignment = chooseCoordinatedPair(ready.map(state => state.scans), venues,
      times, claimed, excludedPairs);
    if (!assignment) {
      await scanForAccounts(ready, date, venues, times);
      assignment = chooseCoordinatedPair(ready.map(state => state.scans), venues,
        times, claimed, excludedPairs);
      if (!assignment) throw new NoAvailableSlotError('两个账号没有共同可用的连续两小时时段');
    }
    log(`协同选择连续时段：${ready[0].config.id} ${assignment[0]}，${ready[1].config.id} ${assignment[1]}。`);
    const attemptMs = Math.min(30000, Math.max(1000, deadline - Date.now()));
    const outcomes = await Promise.allSettled(ready.map((state, index) =>
      bookForAccount(state, date, claimed, venues, [assignment[index]],
        { skipInitialScan: true, maxDurationMs: attemptMs })));
    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'rejected') {
        log(`${ready[index].config.id} ${assignment[index]} 未完成：${outcome.reason.message}`);
      }
    });
    const paid = ready.filter(state => state.paid);
    if (paid.length === 2) return;
    const fatal = outcomes.find(outcome => outcome.status === 'rejected' &&
      !(outcome.reason instanceof NoAvailableSlotError));
    if (fatal) throw fatal.reason;
    if (paid.length === 1) {
      const other = ready.find(state => !state.paid);
      const adjacent = adjacentTimes(times, paid[0].order.time);
      if (!adjacent.length) throw new Error(`已付时段 ${paid[0].order.time} 没有配置相邻时段`);
      log(`${other.config.id} 仅尝试与已付时段 ${paid[0].order.time} 相邻的 ${adjacent.join('、')}。`);
      await scanForAccounts([other], date, venues, adjacent);
      await bookForAccount(other, date, claimed, venues, adjacent,
        { skipInitialScan: true, maxDurationMs: Math.max(1000, deadline - Date.now()) });
      return;
    }
    const pair = consecutivePairs(times).find(value =>
      value.includes(assignment[0]) && value.includes(assignment[1]));
    excludedPairs.add(pair.join('|'));
    await scanForAccounts(ready, date, venues, times);
  }
  throw new NoAvailableSlotError('三分钟内未能完成连续两小时预约');
}

async function main(date, preflightOnly = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    throw new Error('用法：node pair.js YYYY-MM-DD [--preflight]');
  }
  const target = loadPairTarget(date);
  const venues = target.venues.map(id => VENUES.find(venue => venue.id === id));
  const accounts = target.accounts.map(id => {
    if (!ACCOUNT_IDS.includes(id)) throw new Error(`未知预约账号：${id}`);
    return { id, buddy: buddyFor(id) };
  });
  const times = target.times;
  log(`目标：${date}；账号 ${target.accounts.join('、')}；场馆 ${venues.map(venue => venue.name).join('、')}；时段 ${times.join(' → ')}。`);
  const sessions = new Map();
  try {
    // The login OCR uses spawnSync. Starting both logins together blocks the
    // event loop while the other account waits for a slider response.
    const ready = [];
    for (const config of accounts) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          ready.push(await prepareAccount(config, date, sessions, venues, preflightOnly ? 2 : 15));
          break;
        } catch (error) {
          log(`${config.id} 第 ${attempt} 次预登录失败：${error.message}`);
          const previous = sessions.get(config.id);
          if (previous?.context) await previous.context.close().catch(() => {});
          sessions.delete(config.id);
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    if (!ready.length) throw new Error('所选账号均未能登录场馆网站');
    if (preflightOnly) {
      if (ready.length !== accounts.length) throw new Error('所选账号预登录检查未全部通过');
      log('所选账号和场馆的预登录检查通过；未提交订单。');
      return;
    }
    await waitForRelease(date);
    const claimed = new Set();
    if (accounts.length === 2 && ready.length === 2) {
      await bookCoordinated(ready, date, claimed, venues, times);
    } else {
      const results = await Promise.allSettled(ready.map(state =>
        bookForAccount(state, date, claimed, venues, times)));
      results.forEach((result, index) => {
        if (result.status === 'rejected') log(`${ready[index].config.id} 预约失败：${result.reason.message}`);
      });
    }
    if (ready.length === accounts.length && ready.every(state => state.paid)) {
      if (accounts.length === 2 && !adjacentTimes(times, ready[0].order.time).includes(ready[1].order.time)) {
        throw new Error('两个订单已支付，但时段不连续，请核查预约记录');
      }
      if (accounts.length === 2) {
        log(`连续两小时已支付：${ready.map(state => state.order.time).join('、')}。`);
      } else {
        log('所选账号的零元订单已支付。');
      }
      return;
    }
    throw new Error('所选账号未全部完成预约，请分别查看预约记录');
  } finally {
    const sessionsWithContext = [...sessions.values()].filter(item => item?.context);
    if (sessionsWithContext.length && await Promise.all(sessionsWithContext.map(item =>
      hasPendingPayment(item.context).catch(() => false))).then(values => values.some(Boolean))) {
      log('检测到仍可支付的订单页，暂时保持浏览器打开。');
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        const any = await Promise.all(sessionsWithContext.map(item =>
          hasPendingPayment(item.context).catch(() => false))).then(values => values.some(Boolean));
        if (!any) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    await Promise.all(sessionsWithContext.map(item => item.context.close().catch(() => {})));
  }
}

if (require.main === module) {
  const extra = process.argv[3];
  if (extra && extra !== '--preflight') {
    console.error('用法：node pair.js YYYY-MM-DD [--preflight]');
    process.exitCode = 1;
  } else {
    main(process.argv[2], extra === '--preflight')
      .catch(error => { console.error(`失败：${error.message}`); process.exitCode = 1; });
  }
}

module.exports = { chooseCandidate, chooseCoordinatedPair, slotKey, TIMES };
