/*
 * Pure logic for Split Bill — no DOM access, shared between the browser
 * (window.SplitLogic) and Node tests (module.exports).
 * All money values are integer cents.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SplitLogic = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function newId() {
    return Math.random().toString(36).slice(2, 10);
  }

  // "12", "12.3", "12.34", "1,234.56", comma-as-decimal "12,34" -> cents
  function parseAmountToCents(input) {
    let s = String(input).trim().replace(/\s/g, '');
    if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
    const [whole, frac = ''] = s.split('.');
    if (whole.length > 10) return null;
    return parseInt(whole, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
  }

  function formatMoney(cents, currency) {
    const value = cents / 100;
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency,
      }).format(value);
    } catch (e) {
      return currency + ' ' + value.toFixed(2);
    }
  }

  // Headcount is a multiple of 0.5 (min 0.5); missing/invalid counts as 1.
  function normalizeHeadcount(value) {
    const h = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
    if (!isFinite(h) || h <= 0) return 1;
    return Math.max(0.5, Math.round(h * 2) / 2);
  }

  /*
   * Per-person totals, weighted by headcount. Each sharer owes
   * floor(amount * headcount / totalHeadcount) — computed in half-person
   * units so the math stays integer — and leftover cents go one each to the
   * earliest sharers (item order) so every item reconciles exactly.
   * Returns { personId: { paidCents, owedCents, netCents } }.
   */
  function computeBalances(bill) {
    const balances = {};
    const unitsById = {};
    for (const p of bill.people) {
      balances[p.id] = { paidCents: 0, owedCents: 0, netCents: 0 };
      unitsById[p.id] = Math.round(normalizeHeadcount(p.headcount) * 2);
    }
    for (const item of bill.items) {
      if (balances[item.paidBy]) balances[item.paidBy].paidCents += item.amountCents;
      const sharers = item.sharedBy.filter((id) => balances[id]);
      if (sharers.length === 0) continue;
      const totalUnits = sharers.reduce((sum, id) => sum + unitsById[id], 0);
      const shares = sharers.map((id) => Math.floor((item.amountCents * unitsById[id]) / totalUnits));
      let remainder = item.amountCents - shares.reduce((sum, s) => sum + s, 0);
      sharers.forEach((id, i) => {
        balances[id].owedCents += shares[i] + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
      });
    }
    for (const id in balances) {
      balances[id].netCents = balances[id].paidCents - balances[id].owedCents;
    }
    return balances;
  }

  /*
   * Greedy settle-up: match largest debtor with largest creditor until all
   * nets are zero. At most (people - 1) transfers.
   * Returns [{ from, to, amountCents }].
   */
  function settle(balances) {
    const debtors = [];
    const creditors = [];
    for (const [id, b] of Object.entries(balances)) {
      if (b.netCents < 0) debtors.push({ id, amount: -b.netCents });
      else if (b.netCents > 0) creditors.push({ id, amount: b.netCents });
    }
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);
    const transfers = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amount = Math.min(debtors[i].amount, creditors[j].amount);
      if (amount > 0) transfers.push({ from: debtors[i].id, to: creditors[j].id, amountCents: amount });
      debtors[i].amount -= amount;
      creditors[j].amount -= amount;
      if (debtors[i].amount === 0) i++;
      if (creditors[j].amount === 0) j++;
    }
    return transfers;
  }

  function bytesToB64url(bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlToBytes(str) {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Payload: 'c' + base64url(deflate-raw(json)), or 'j' + base64url(json)
  // when CompressionStream is unavailable.
  async function encodeBill(bill) {
    const json = JSON.stringify(bill);
    try {
      if (typeof CompressionStream === 'undefined') throw new Error('unsupported');
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      return 'c' + bytesToB64url(bytes);
    } catch (e) {
      return 'j' + bytesToB64url(new TextEncoder().encode(json));
    }
  }

  async function decodeBill(payload) {
    const kind = payload[0];
    const bytes = b64urlToBytes(payload.slice(1));
    let json;
    if (kind === 'c') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      json = await new Response(stream).text();
    } else if (kind === 'j') {
      json = new TextDecoder().decode(bytes);
    } else {
      throw new Error('Unknown payload format');
    }
    const bill = JSON.parse(json);
    if (!bill || bill.v !== 1 || !Array.isArray(bill.people) || !Array.isArray(bill.items)) {
      throw new Error('Invalid bill data');
    }
    return bill;
  }

  return {
    newId,
    parseAmountToCents,
    formatMoney,
    normalizeHeadcount,
    computeBalances,
    settle,
    encodeBill,
    decodeBill,
  };
});
