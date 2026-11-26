'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

function readCredential(account = 'primary') {
  if (!['primary', 'secondary'].includes(account)) throw new Error('未知预约账号');
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'read-credential.ps1'), '-Account', account,
  ], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (result.status === 2) return null;
  if (result.status !== 0) throw new Error('无法读取当前 Windows 用户加密的登录凭据');
  const credential = JSON.parse(result.stdout.trim());
  if (!/^\d+$/.test(credential.username) || !credential.password) throw new Error('加密凭据格式无效');
  return credential;
}

module.exports = { readCredential };
