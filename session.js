'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

function callPowerShell(script, account, input) {
  return spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-File', path.join(__dirname, script), '-Account', account,
  ], { input, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
}

function isNjuSessionCookie(cookie) {
  return cookie.expires === -1 &&
    ['authserver.nju.edu.cn', 'ggtypt.nju.edu.cn'].includes(cookie.domain) &&
    typeof cookie.name === 'string' && typeof cookie.value === 'string';
}

async function restoreSession(context, log, account = 'primary') {
  if (!['primary', 'secondary'].includes(account)) throw new Error('未知预约账号');
  const result = callPowerShell('read-session.ps1', account);
  if (result.status === 2) return;
  if (result.status !== 0) {
    log('之前保存的登录会话无法解密，改用自动登录。');
    return;
  }
  try {
    const cookies = JSON.parse(result.stdout);
    if (!Array.isArray(cookies) || !cookies.every(isNjuSessionCookie)) throw new Error('invalid cookies');
    await context.addCookies(cookies);
    log('已恢复加密保存的南大会话 Cookie。');
  } catch {
    log('之前保存的登录会话无效，改用自动登录。');
  }
}

async function saveSession(context, log, account = 'primary') {
  if (!['primary', 'secondary'].includes(account)) throw new Error('未知预约账号');
  const cookies = (await context.cookies()).filter(isNjuSessionCookie);
  if (!cookies.some(cookie => cookie.name === 'MOD_AUTH_CAS')) return;
  const result = callPowerShell('save-session.ps1', account, JSON.stringify(cookies));
  if (result.status !== 0) log('本次登录成功，但会话 Cookie 加密保存失败；下次会重新登录。');
}

module.exports = { restoreSession, saveSession };
