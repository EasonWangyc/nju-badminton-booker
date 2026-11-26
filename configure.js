'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const {
  TIME_SLOTS, DEFAULT_TIMES, chinaDate, validateDate, normalizePairTarget, saveTarget,
} = require('./booking-config');

const VENUE_LABELS = { 126: '仙林校区四组团体育馆', 120: '仙林校区方肇周体育馆' };
const ACCOUNT_LABELS = { primary: '账号1', secondary: '账号2' };

function showTarget(target, saved = true) {
  console.log(`\n${saved ? '已设置' : '待保存'} ${target.date} 的预约任务（每天 07:55 启动，08:00 开放后选场）。`);
  if (target.mode === 'pair') {
    console.log(`账号：${target.accounts.map(id => ACCOUNT_LABELS[id]).join('、')}`);
    console.log(`场馆：${target.venues.map(id => VENUE_LABELS[id]).join('、')}`);
    console.log(`时段优先顺序：${target.times.join(' → ')}`);
    console.log(target.accounts.length === 2
      ? '两个账号各预约一小时，时段必须相邻；场号可以不同。'
      : '所选账号尝试预约一小时。');
  } else {
    console.log('模式：原有单账号默认策略。');
  }
  console.log('电脑须保持开机，当前 Windows 用户须已登录。');
}

function parseCsv(value, convert = item => item) {
  return value.split(',').map(item => convert(item.trim()));
}

async function choose(input, prompt, allowed, fallback) {
  for (;;) {
    const value = (await input.question(`${prompt} [${fallback}]：`)).trim() || fallback;
    if (allowed.includes(value)) return value;
    console.log(`请输入 ${allowed.join('、')}。`);
  }
}

function defaultAccountChoice() {
  const primary = fs.existsSync(path.join(__dirname, '.credentials.dpapi'));
  const secondary = fs.existsSync(path.join(__dirname, '.credentials-secondary.dpapi'));
  if (primary && !secondary) return '2';
  if (secondary && !primary) return '3';
  return '1';
}

function configureCli(args) {
  if (args.length === 1 && args[0] === '--clear') {
    saveTarget({ date: null });
    console.log('已清除预约日期；计划任务将保持空闲。');
    return;
  }
  const [date, ...flags] = args;
  validateDate(date);
  const selected = { date };
  let pair = false;
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    if (flag === '--pair') { pair = true; continue; }
    if (!['--venues', '--accounts', '--times'].includes(flag) || !flags[index + 1]) {
      throw new Error(`未知或缺少参数：${flag}`);
    }
    const value = flags[++index];
    if (flag === '--venues') selected.venues = parseCsv(value, Number);
    if (flag === '--accounts') selected.accounts = parseCsv(value);
    if (flag === '--times') selected.times = parseCsv(value);
    pair = true;
  }
  const target = pair ? normalizePairTarget(selected) : { date, mode: 'single' };
  saveTarget(target);
  showTarget(target);
}

async function configureInteractive() {
  const input = readline.createInterface({ input: stdin, output: stdout });
  try {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const defaultDate = chinaDate(tomorrow);
    console.log('南京大学羽毛球预约条件设置');
    console.log('直接按回车使用方括号中的默认选项。');
    console.log(`使用日期：1 明天（${defaultDate}）；2 指定日期`);
    const dateChoice = await choose(input, '选择', ['1', '2'], '1');
    let date = defaultDate;
    if (dateChoice === '2') {
      for (;;) {
        date = (await input.question('使用日期（YYYY-MM-DD）：')).trim();
        try { validateDate(date); break; }
        catch (error) { console.log(error.message); }
      }
    }
    console.log('账号：1 两个账号；2 仅账号1；3 仅账号2');
    const accountChoice = await choose(input, '选择', ['1', '2', '3'], defaultAccountChoice());
    const accounts = { 1: ['primary', 'secondary'], 2: ['primary'], 3: ['secondary'] }[accountChoice];
    console.log('场馆：1 方肇周体育馆；2 四组团体育馆；3 两馆都可');
    const venueChoice = await choose(input, '选择', ['1', '2', '3'], '3');
    const venues = { 1: [120], 2: [126], 3: [126, 120] }[venueChoice];
    console.log('时段：1 16:00–20:00，按早到晚；2 仅 16:00–18:00；3 仅 18:00–20:00；4 自定义优先顺序');
    let target;
    while (!target) {
      const timeChoice = await choose(input, '选择', ['1', '2', '3', '4'], '1');
      let times = {
        1: DEFAULT_TIMES, 2: DEFAULT_TIMES.slice(0, 2), 3: DEFAULT_TIMES.slice(2),
      }[timeChoice];
      if (timeChoice === '4') {
        console.log('1=16:00-17:00，2=17:00-18:00，3=18:00-19:00，4=19:00-20:00，5=20:00-21:00，6=21:00-22:00');
        const order = await input.question('按优先顺序输入编号，用英文逗号分隔（如 2,1,3）：');
        times = parseCsv(order, value => TIME_SLOTS[Number(value) - 1]);
      }
      try { target = normalizePairTarget({ date, accounts, venues, times }); }
      catch (error) { console.log(`时段选择无效：${error.message}，请重新选择。`); }
    }
    showTarget(target, false);
    const confirmation = await choose(input, '保存并启用以上条件？Y 是 / N 取消', ['Y', 'y', 'N', 'n'], 'Y');
    if (confirmation.toLowerCase() === 'n') {
      console.log('已取消，原有预约条件未更改。');
      return;
    }
    saveTarget(target);
    console.log('已保存预约条件。');
  } finally {
    input.close();
  }
}

const args = process.argv.slice(2);
if (args.length === 0 || (args.length === 1 && args[0] === '--interactive')) {
  configureInteractive().catch(error => { console.error(`设置失败：${error.message}`); process.exitCode = 1; });
} else if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log('用法：node configure.js [--interactive | --clear | YYYY-MM-DD [--pair] [--venues 126,120] [--accounts primary,secondary] [--times 16:00-17:00,17:00-18:00]]');
  console.log('不传参数时进入交互菜单。');
} else {
  try { configureCli(args); }
  catch (error) { console.error(`设置失败：${error.message}`); process.exitCode = 1; }
}
