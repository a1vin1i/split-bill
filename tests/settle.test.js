'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

function makeBill(people, items) {
  return { v: 1, id: 'test', title: 'Test', currency: 'HKD', people, items };
}

const A = { id: 'a', name: 'Alvin', payLink: '' };
const B = { id: 'b', name: 'Bob', payLink: '' };
const C = { id: 'c', name: 'Carol', payLink: '' };
const D = { id: 'd', name: 'Dave', payLink: '' };

test('parseAmountToCents', () => {
  assert.strictEqual(L.parseAmountToCents('12'), 1200);
  assert.strictEqual(L.parseAmountToCents('12.3'), 1230);
  assert.strictEqual(L.parseAmountToCents('12.34'), 1234);
  assert.strictEqual(L.parseAmountToCents('12,34'), 1234); // comma decimal
  assert.strictEqual(L.parseAmountToCents('1,234.56'), 123456); // thousands
  assert.strictEqual(L.parseAmountToCents(' 600 '), 60000);
  assert.strictEqual(L.parseAmountToCents('0'), 0);
  assert.strictEqual(L.parseAmountToCents('abc'), null);
  assert.strictEqual(L.parseAmountToCents('12.345'), null);
  assert.strictEqual(L.parseAmountToCents('-5'), null);
  assert.strictEqual(L.parseAmountToCents(''), null);
});

test('remainder cents distributed so item reconciles exactly', () => {
  // $1.00 split 3 ways -> 34 + 33 + 33
  const bill = makeBill([A, B, C], [
    { id: 'i1', desc: 'x', amountCents: 100, paidBy: 'a', sharedBy: ['a', 'b', 'c'] },
  ]);
  const bal = L.computeBalances(bill);
  assert.strictEqual(bal.a.owedCents, 34);
  assert.strictEqual(bal.b.owedCents, 33);
  assert.strictEqual(bal.c.owedCents, 33);
  assert.strictEqual(bal.a.owedCents + bal.b.owedCents + bal.c.owedCents, 100);
  assert.strictEqual(bal.a.netCents, 66);
});

test('mixed payers and share subsets', () => {
  const bill = makeBill([A, B, C, D], [
    { id: 'i1', desc: 'Dinner', amountCents: 60000, paidBy: 'a', sharedBy: ['a', 'b', 'c', 'd'] },
    { id: 'i2', desc: 'Drinks', amountCents: 20000, paidBy: 'b', sharedBy: ['a', 'b'] },
    { id: 'i3', desc: 'Taxi', amountCents: 12000, paidBy: 'a', sharedBy: ['c', 'd'] },
  ]);
  const bal = L.computeBalances(bill);
  assert.strictEqual(bal.a.paidCents, 72000);
  assert.strictEqual(bal.a.owedCents, 25000); // 15000 dinner + 10000 drinks
  assert.strictEqual(bal.b.owedCents, 25000);
  assert.strictEqual(bal.c.owedCents, 21000); // 15000 dinner + 6000 taxi
  // Nets always sum to zero.
  const totalNet = Object.values(bal).reduce((s, b) => s + b.netCents, 0);
  assert.strictEqual(totalNet, 0);
});

test('settle produces transfers that zero out all balances', () => {
  const bill = makeBill([A, B, C, D], [
    { id: 'i1', desc: 'Dinner', amountCents: 60000, paidBy: 'a', sharedBy: ['a', 'b', 'c', 'd'] },
    { id: 'i2', desc: 'Drinks', amountCents: 20000, paidBy: 'b', sharedBy: ['a', 'b', 'c', 'd'] },
    { id: 'i3', desc: 'Snacks', amountCents: 10001, paidBy: 'c', sharedBy: ['a', 'b', 'c'] },
  ]);
  const bal = L.computeBalances(bill);
  const transfers = L.settle(bal);
  assert.ok(transfers.length <= 3, 'at most people-1 transfers');
  const net = {};
  for (const id of ['a', 'b', 'c', 'd']) net[id] = bal[id].netCents;
  for (const t of transfers) {
    assert.ok(t.amountCents > 0);
    net[t.from] += t.amountCents;
    net[t.to] -= t.amountCents;
  }
  for (const id of ['a', 'b', 'c', 'd']) {
    assert.strictEqual(net[id], 0, `person ${id} settled`);
  }
});

test('settle with everyone even returns no transfers', () => {
  const bill = makeBill([A, B], [
    { id: 'i1', desc: 'x', amountCents: 1000, paidBy: 'a', sharedBy: ['a', 'b'] },
    { id: 'i2', desc: 'y', amountCents: 1000, paidBy: 'b', sharedBy: ['a', 'b'] },
  ]);
  assert.deepStrictEqual(L.settle(L.computeBalances(bill)), []);
});

test('single payer, others owe them', () => {
  const bill = makeBill([A, B, C], [
    { id: 'i1', desc: 'x', amountCents: 30000, paidBy: 'a', sharedBy: ['a', 'b', 'c'] },
  ]);
  const transfers = L.settle(L.computeBalances(bill));
  assert.strictEqual(transfers.length, 2);
  for (const t of transfers) {
    assert.strictEqual(t.to, 'a');
    assert.strictEqual(t.amountCents, 10000);
  }
});

test('normalizeHeadcount', () => {
  assert.strictEqual(L.normalizeHeadcount(2), 2);
  assert.strictEqual(L.normalizeHeadcount('2.5'), 2.5);
  assert.strictEqual(L.normalizeHeadcount('0,5'), 0.5); // comma decimal
  assert.strictEqual(L.normalizeHeadcount(0.7), 0.5); // rounds to nearest 0.5
  assert.strictEqual(L.normalizeHeadcount(0.1), 0.5); // clamps to minimum
  assert.strictEqual(L.normalizeHeadcount(undefined), 1); // missing -> 1
  assert.strictEqual(L.normalizeHeadcount('abc'), 1);
  assert.strictEqual(L.normalizeHeadcount(-3), 1);
});

test('split is weighted by headcount', () => {
  const family = { id: 'f', name: 'Chans', payLink: '', headcount: 2 };
  const single = { id: 's', name: 'Bob', payLink: '', headcount: 1 };
  const bill = makeBill([family, single], [
    { id: 'i1', desc: 'x', amountCents: 30000, paidBy: 's', sharedBy: ['f', 's'] },
  ]);
  const bal = L.computeBalances(bill);
  assert.strictEqual(bal.f.owedCents, 20000); // 2 of 3 shares
  assert.strictEqual(bal.s.owedCents, 10000); // 1 of 3 shares
});

test('half headcount and remainder cents still reconcile exactly', () => {
  const child = { id: 'k', name: 'Kid', payLink: '', headcount: 0.5 };
  const adult = { id: 'a', name: 'Alvin', payLink: '', headcount: 1 };
  const bill = makeBill([child, adult], [
    { id: 'i1', desc: 'x', amountCents: 100, paidBy: 'a', sharedBy: ['k', 'a'] },
  ]);
  const bal = L.computeBalances(bill);
  // 1 of 3 units = 33.33 -> floor 33, remainder cent goes to first sharer
  assert.strictEqual(bal.k.owedCents, 34);
  assert.strictEqual(bal.a.owedCents, 66);
  assert.strictEqual(bal.k.owedCents + bal.a.owedCents, 100);
});

test('people without headcount default to 1 (old bills keep working)', () => {
  const bill = makeBill([A, B], [
    { id: 'i1', desc: 'x', amountCents: 1000, paidBy: 'a', sharedBy: ['a', 'b'] },
  ]);
  const bal = L.computeBalances(bill);
  assert.strictEqual(bal.a.owedCents, 500);
  assert.strictEqual(bal.b.owedCents, 500);
});

test('items referencing unknown people are ignored gracefully', () => {
  const bill = makeBill([A, B], [
    { id: 'i1', desc: 'x', amountCents: 1000, paidBy: 'ghost', sharedBy: ['ghost', 'a'] },
  ]);
  const bal = L.computeBalances(bill);
  assert.strictEqual(bal.a.owedCents, 1000); // only known sharers split it
  assert.strictEqual(bal.b.owedCents, 0);
});

test('encodeBill/decodeBill round trip (compressed)', async () => {
  const bill = makeBill([A, B, C], [
    { id: 'i1', desc: 'Dinner 晚餐', amountCents: 61234, paidBy: 'a', sharedBy: ['a', 'b', 'c'] },
  ]);
  const payload = await L.encodeBill(bill);
  assert.strictEqual(payload[0], 'c', 'uses compression in Node 18+');
  assert.match(payload, /^[A-Za-z0-9_-]+$/, 'URL-safe, no percent-encoding needed');
  const decoded = await L.decodeBill(payload);
  assert.deepStrictEqual(decoded, bill);
});

test('decodeBill accepts plain-JSON fallback payloads', async () => {
  const bill = makeBill([A], []);
  const json = JSON.stringify(bill);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  const decoded = await L.decodeBill('j' + b64);
  assert.deepStrictEqual(decoded, bill);
});

test('decodeBill rejects garbage', async () => {
  await assert.rejects(() => L.decodeBill('xnotvalid'));
  await assert.rejects(() => L.decodeBill('j' + Buffer.from('{"v":2}').toString('base64url')));
});
