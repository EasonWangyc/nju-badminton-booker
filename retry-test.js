'use strict';

const assert = require('node:assert/strict');
const { chooseCandidate } = require('./book');

const free = (court, time) => ({ court, time, status: '空闲', className: '' });
const scans = [
  [free('1号', '18:00-19:00'), free('2号', '18:00-19:00'), free('3号', '19:00-20:00')],
  [free('10号', '18:00-19:00')],
];
const tried = new Set();
let candidate = chooseCandidate(scans, tried);
assert.equal(candidate.court, '1号');
tried.add(`${candidate.pageIndex}:${candidate.court}:${candidate.time}`);
candidate = chooseCandidate(scans, tried);
assert.equal(candidate.court, '2号');
tried.add(`${candidate.pageIndex}:${candidate.court}:${candidate.time}`);
candidate = chooseCandidate(scans, tried);
assert.equal(candidate.court, '10号');
console.log('场地被抢后的候选顺序测试通过');
