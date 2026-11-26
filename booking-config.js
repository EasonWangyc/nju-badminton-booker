'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TARGET_PATH = path.join(__dirname, 'target.json');
const VENUE_IDS = [126, 120];
const ACCOUNT_IDS = ['primary', 'secondary'];
const TIME_SLOTS = [
  '16:00-17:00', '17:00-18:00', '18:00-19:00', '19:00-20:00',
  '20:00-21:00', '21:00-22:00',
];
const DEFAULT_TIMES = TIME_SLOTS.slice(0, 4);

function chinaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validateDate(date, allowPast = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('日期格式须为 YYYY-MM-DD');
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error('日期无效');
  }
  if (!allowPast && date < chinaDate()) throw new Error('预约日期已经过去');
  return date;
}

function validateChoices(values, allowed, name) {
  if (!Array.isArray(values) || !values.length || new Set(values).size !== values.length ||
      values.some(value => !allowed.includes(value))) {
    throw new Error(`${name}选择无效或重复`);
  }
  return values;
}

function timeRange(slot) {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(slot);
  if (!match) throw new Error(`时段格式无效：${slot}`);
  return { start: Number(match[1]) * 60 + Number(match[2]),
    end: Number(match[3]) * 60 + Number(match[4]) };
}

function consecutivePairs(times) {
  const pairs = [];
  for (let first = 0; first < times.length; first++) {
    for (let second = first + 1; second < times.length; second++) {
      const a = timeRange(times[first]);
      const b = timeRange(times[second]);
      if (a.end === b.start) pairs.push({ times: [times[first], times[second]], priority: second });
      if (b.end === a.start) pairs.push({ times: [times[second], times[first]], priority: second });
    }
  }
  return pairs.sort((a, b) => a.priority - b.priority).map(pair => pair.times);
}

function adjacentTimes(times, bookedTime) {
  const booked = timeRange(bookedTime);
  return times.filter(time => {
    const candidate = timeRange(time);
    return candidate.end === booked.start || candidate.start === booked.end;
  });
}

function normalizePairTarget(input, allowPast = false) {
  const target = {
    date: validateDate(input.date, allowPast),
    mode: 'pair',
    venues: validateChoices(input.venues ?? VENUE_IDS, VENUE_IDS, '场馆'),
    accounts: validateChoices(input.accounts ?? ACCOUNT_IDS, ACCOUNT_IDS, '账号'),
    times: validateChoices(input.times ?? DEFAULT_TIMES, TIME_SLOTS, '时段'),
  };
  if (target.accounts.length === 2 && !consecutivePairs(target.times).length) {
    throw new Error('双账号须选择至少一组连续的两小时时段');
  }
  return target;
}

function saveTarget(target) {
  fs.writeFileSync(TARGET_PATH, `${JSON.stringify(target, null, 2)}\n`, 'utf8');
}

function loadPairTarget(date) {
  const target = JSON.parse(fs.readFileSync(TARGET_PATH, 'utf8'));
  if (target.date !== date || target.mode !== 'pair') {
    throw new Error(`当前双账号目标日期不是 ${date}；请先运行条件设置程序`);
  }
  return normalizePairTarget(target, true);
}

module.exports = {
  TARGET_PATH, VENUE_IDS, ACCOUNT_IDS, TIME_SLOTS, DEFAULT_TIMES,
  chinaDate, validateDate, consecutivePairs, adjacentTimes,
  normalizePairTarget, saveTarget, loadPairTarget,
};
