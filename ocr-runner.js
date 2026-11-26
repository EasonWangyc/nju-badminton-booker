'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ocrConfig } = require('./machine-config');

function toWslPath(windowsPath) {
  const absolute = path.resolve(windowsPath);
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(absolute);
  if (!match) throw new Error(`无法转换为 WSL 路径：${absolute}`);
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
}

function runOcr(scriptName, args, input) {
  const ocr = ocrConfig();
  const script = path.join(__dirname, scriptName);
  let command;
  let commandArgs;
  if (ocr.runner === 'wsl') {
    command = 'wsl.exe';
    commandArgs = ['-d', ocr.distribution, '-e', ocr.python, toWslPath(script), ...args];
  } else {
    command = /[\\/]/.test(ocr.python) && !path.isAbsolute(ocr.python)
      ? path.resolve(__dirname, ocr.python) : ocr.python;
    commandArgs = [script, ...args];
  }
  const result = spawnSync(command, commandArgs, {
    input, encoding: 'utf8', maxBuffer: 1024 * 1024,
    timeout: 20000, windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`OCR 执行失败：${(result.stderr || result.error?.message || `退出码 ${result.status}`).slice(0, 300)}`);
  }
  try { return JSON.parse(result.stdout.trim()); }
  catch { throw new Error('OCR 未返回有效 JSON'); }
}

module.exports = { runOcr, toWslPath };
