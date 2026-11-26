'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, 'config.local.json');

function loadMachineConfig() {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取本机配置 config.local.json：${error.message}`);
  }
  if (!config || typeof config !== 'object' || !config.accounts || !config.ocr) {
    throw new Error('config.local.json 缺少 accounts 或 ocr 配置');
  }
  return config;
}

function buddyFor(account) {
  if (!['primary', 'secondary'].includes(account)) throw new Error('未知预约账号');
  const buddy = loadMachineConfig().accounts[account]?.buddy;
  if (typeof buddy !== 'string' || !buddy.trim()) {
    throw new Error(`请在 config.local.json 中配置 ${account} 的同伴姓名`);
  }
  return buddy.trim();
}

function ocrConfig() {
  const ocr = loadMachineConfig().ocr;
  if (!['wsl', 'windows'].includes(ocr.runner) ||
      typeof ocr.python !== 'string' || !ocr.python.trim()) {
    throw new Error('config.local.json 的 OCR 运行方式或 Python 路径无效');
  }
  if (ocr.runner === 'wsl' && (!ocr.distribution || !ocr.python.startsWith('/'))) {
    throw new Error('WSL OCR 须配置发行版和 Linux Python 绝对路径');
  }
  return ocr;
}

module.exports = { CONFIG_PATH, loadMachineConfig, buddyFor, ocrConfig };
