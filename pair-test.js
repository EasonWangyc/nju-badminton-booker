'use strict';

const assert = require('node:assert/strict');
const { chooseCandidate, chooseCoordinatedPair, slotKey } = require('./pair');
const { normalizePairTarget, consecutivePairs, adjacentTimes } = require('./booking-config');

const slot = (court, time) => ({ court, time, status: '空闲', className: '' });
const scans = [
  [slot('7号', '16:00-17:00'), slot('1号', '18:00-19:00')],
  [slot('10号', '16:00-17:00'), slot('4号', '17:00-18:00')],
];
const claimed = new Set();
let choice = chooseCandidate(scans, claimed);
assert.equal(choice.venue.id, 126);
assert.equal(choice.time, '16:00-17:00');
claimed.add(slotKey(choice));
choice = chooseCandidate(scans, claimed);
assert.equal(choice.venue.id, 120);
assert.equal(choice.time, '16:00-17:00');
claimed.add(slotKey(choice));
choice = chooseCandidate(scans, claimed);
assert.equal(choice.court, '4号');
assert.equal(choice.time, '17:00-18:00');

assert.equal(chooseCandidate([[slot('1号', '18:00-19:00')], []]).time, '18:00-19:00');
assert.equal(chooseCandidate(scans, new Set(), [1, 0]).venue.id, 120);
const fangOnly = [{ id: 120, name: '仙林校区方肇周体育馆' }];
const fangChoice = chooseCandidate([
  [slot('1号', '16:00-17:00'), slot('2号', '17:00-18:00')],
], new Set(), [0], fangOnly, ['17:00-18:00']);
assert.equal(fangChoice.venue.id, 120);
assert.equal(fangChoice.time, '17:00-18:00');
const configured = normalizePairTarget({
  date: '2026-11-19', venues: [120], accounts: ['secondary'],
  times: ['20:00-21:00', '16:00-17:00'],
}, true);
assert.deepEqual(configured.venues, [120]);
assert.deepEqual(configured.accounts, ['secondary']);
assert.deepEqual(configured.times, ['20:00-21:00', '16:00-17:00']);
assert.throws(() => normalizePairTarget({ date: '2026-11-19', venues: [121] }, true), /场馆选择无效/);
assert.throws(() => normalizePairTarget({
  date: '2026-11-19', accounts: ['primary', 'secondary'],
  times: ['16:00-17:00', '18:00-19:00'],
}, true), /连续的两小时/);
assert.deepEqual(consecutivePairs([
  '16:00-17:00', '17:00-18:00', '18:00-19:00', '19:00-20:00',
]), [
  ['16:00-17:00', '17:00-18:00'],
  ['17:00-18:00', '18:00-19:00'],
  ['18:00-19:00', '19:00-20:00'],
]);
assert.deepEqual(adjacentTimes([
  '16:00-17:00', '17:00-18:00', '18:00-19:00',
], '17:00-18:00'), ['16:00-17:00', '18:00-19:00']);
const twoAccounts = [
  [[slot('7号', '16:00-17:00'), slot('7号', '17:00-18:00')]],
  [[slot('8号', '16:00-17:00'), slot('8号', '17:00-18:00')]],
];
assert.deepEqual(chooseCoordinatedPair(twoAccounts, fangOnly,
  ['16:00-17:00', '17:00-18:00']), ['16:00-17:00', '17:00-18:00']);
assert.deepEqual(chooseCoordinatedPair([
  [[slot('7号', '17:00-18:00')]],
  [[slot('8号', '16:00-17:00')]],
], fangOnly, ['16:00-17:00', '17:00-18:00']), ['17:00-18:00', '16:00-17:00']);
assert.equal(chooseCoordinatedPair([
  [[slot('7号', '16:00-17:00')]],
  [[slot('8号', '16:00-17:00')]],
], fangOnly, ['16:00-17:00', '17:00-18:00']), null);
console.log('双账号连续时段分配、双场馆和重复场地排除测试通过');
