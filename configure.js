'use strict';

const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const {
  TIME_SLOTS, DEFAULT_TIMES, chinaDate, validateDate, normalizePairTarget, saveTarget,
} = require('./booking-config');

const VENUE_LABELS = { 126: '仙林校区四组团体育馆', 120: '仙林校区方肇周体育馆' };
const ACCOUNT_LABELS = { primary: '账号1', secondary: '账号2' };

function showTarget(target) {
  console.log(`\n已设置 ${target.date} 的预约任务（每天 07:55 启动，08:00 开放后选场）。`);
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
    const date = (await input.question(`使用日期 [${defaultDate}]：`)).trim() || defaultDate;
    validateDate(date);
    console.log('账号：1 两个账号；2 仅账号1；3 仅账号2');
    const accountChoice = (await input.question('选择 [1]：')).trim() || '1';
    const accounts = { 1: ['primary', 'secondary'], 2: ['primary'], 3: ['secondary'] }[accountChoice];
    if (!accounts) throw new Error('账号选项无效');
    console.log('场馆：1 方肇周体育馆；2 四组团体育馆；3 两馆都可');
    const venueChoice = (await input.question('选择 [3]：')).trim() || '3';
    const venues = { 1: [120], 2: [126], 3: [126, 120] }[venueChoice];
    if (!venues) throw new Error('场馆选项无效');
    console.log('时段：1 16:00–20:00，按早到晚；2 仅 16:00–18:00；3 仅 18:00–20:00；4 自定义优先顺序');
    const timeChoice = (await input.question('选择 [1]：')).trim() || '1';
    let times = {
      1: DEFAULT_TIMES, 2: DEFAULT_TIMES.slice(0, 2), 3: DEFAULT_TIMES.slice(2),
    }[timeChoice];
    if (timeChoice === '4') {
      console.log('1=16:00-17:00，2=17:00-18:00，3=18:00-19:00，4=19:00-20:00，5=20:00-21:00，6=21:00-22:00');
      const order = await input.question('按优先顺序输入编号，用英文逗号分隔（如 2,1,3）：');
      times = parseCsv(order, value => TIME_SLOTS[Number(value) - 1]);
    }
    if (!times) throw new Error('时段选项无效');
    const target = normalizePairTarget({ date, accounts, venues, times });
    saveTarget(target);
    showTarget(target);
  } finally {
    input.close();
  }
}

if (process.argv[2] === '--interactive') {
  if (process.argv.length !== 3) throw new Error('交互模式不接受额外参数');
  configureInteractive().catch(error => { console.error(`设置失败：${error.message}`); process.exitCode = 1; });
} else {
  try { configureCli(process.argv.slice(2)); }
  catch (error) { console.error(`设置失败：${error.message}`); process.exitCode = 1; }
}
