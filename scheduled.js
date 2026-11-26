'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function chinaDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function main() {
  const configPath = path.join(__dirname, 'target.json');
  if (!fs.existsSync(configPath)) return;
  const { date, mode } = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!date || date !== chinaDate()) return;
  if (mode && !['single', 'pair'].includes(mode)) throw new Error(`未知预约模式：${mode}`);
  const logDir = path.join(__dirname, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFd = fs.openSync(path.join(logDir, `${date}.log`), 'a');
  fs.writeSync(logFd, `\n[${new Date().toISOString()}] 计划任务启动\n`);
  const args = mode === 'pair'
    ? [path.join(__dirname, 'pair.js'), date]
    : [path.join(__dirname, 'book.js'), '--book', '--date', date];
  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    env: { ...process.env, NJU_SCHEDULED: '1' },
    stdio: ['ignore', logFd, logFd],
    windowsHide: false,
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  fs.writeSync(logFd, `[${new Date().toISOString()}] 预约脚本退出：${exitCode}\n`);
  fs.closeSync(logFd);
  process.exitCode = exitCode || 0;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
