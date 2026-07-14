/* Split Bill — UI layer. Pure calculations live in logic.js (SplitLogic). */
(function () {
  'use strict';

  const L = window.SplitLogic;
  const $ = (id) => document.getElementById(id);

  const LS_BILLS = 'splitbill.bills.v1';
  const LS_CURRENT = 'splitbill.currentId';
  const LS_MY_PAYLINK = 'splitbill.myPayLink';
  const LS_CONTACTS = 'splitbill.contacts.v1';

  let bill = null;
  // Person dialog context: mode 'bill' edits this bill's copy, 'contact' edits
  // the saved pool. id null = creating; addToBill also puts them on the bill.
  let personCtx = { mode: 'contact', id: null, addToBill: false };
  let editingItemId = null; // null = adding
  let dialogShared = new Set(); // sharedBy selection inside the item dialog
  let pickerSelected = new Set(); // contact selection inside the picker dialog

  /* ---------- Storage ---------- */

  function loadBills() {
    try {
      return JSON.parse(localStorage.getItem(LS_BILLS)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveBill() {
    bill.updatedAt = Date.now();
    const bills = loadBills();
    bills[bill.id] = bill;
    try {
      localStorage.setItem(LS_BILLS, JSON.stringify(bills));
      localStorage.setItem(LS_CURRENT, bill.id);
    } catch (e) {
      /* storage full/unavailable — app still works in memory */
    }
  }

  function loadContacts() {
    try {
      return JSON.parse(localStorage.getItem(LS_CONTACTS)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveContacts(contacts) {
    try {
      localStorage.setItem(LS_CONTACTS, JSON.stringify(contacts));
    } catch (e) {
      /* ignore */
    }
  }

  // One-time bootstrap: build the pool from people already on saved bills.
  function seedContactsIfNeeded() {
    if (localStorage.getItem(LS_CONTACTS) !== null) return;
    const seen = new Set();
    const contacts = [];
    const bills = Object.values(loadBills()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const b of bills) {
      for (const p of b.people || []) {
        const nameKey = p.name.trim().toLowerCase();
        if (seen.has(p.id) || seen.has(nameKey)) continue;
        seen.add(p.id);
        seen.add(nameKey);
        contacts.push({ id: p.id, name: p.name, payLink: p.payLink || '', headcount: L.normalizeHeadcount(p.headcount) });
      }
    }
    saveContacts(contacts);
  }

  function defaultTitle() {
    const d = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return 'Bill ' + d;
  }

  function newBill() {
    return {
      v: 1,
      id: L.newId(),
      title: defaultTitle(),
      currency: 'HKD',
      people: [],
      items: [],
      updatedAt: Date.now(),
    };
  }

  /* ---------- Helpers ---------- */

  function fmt(cents) {
    return L.formatMoney(cents, bill.currency);
  }

  function personById(id) {
    return bill.people.find((p) => p.id === id);
  }

  function personName(id) {
    const p = personById(id);
    return p ? p.name : '?';
  }

  function headcountOf(p) {
    return L.normalizeHeadcount(p.headcount);
  }

  function formatHeadcount(h) {
    return h % 1 === 0 ? String(h) : h.toFixed(1);
  }

  // "Bob" for a single person, "Chans ×2.5" for a family.
  function personLabel(p) {
    const h = headcountOf(p);
    return h === 1 ? p.name : p.name + ' ×' + formatHeadcount(h);
  }

  // Move `autofocus` so showModal() focuses the first input only when adding;
  // when editing, the dialog heading takes focus and no keyboard pops up.
  function setDialogFocus(dialog, firstInput, isNew) {
    const heading = dialog.querySelector('h3');
    if (isNew) {
      heading.removeAttribute('autofocus');
      firstInput.setAttribute('autofocus', '');
    } else {
      firstInput.removeAttribute('autofocus');
      heading.setAttribute('autofocus', '');
    }
  }

  function normalizePayLink(link) {
    if (!link) return '';
    link = link.trim();
    if (!link) return '';
    if (!/^https?:\/\//i.test(link)) link = 'https://' + link;
    return link;
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function shareText(text) {
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /* ---------- Rendering ---------- */

  function render() {
    $('bill-title').value = bill.title;
    const sel = $('currency-select');
    if (![...sel.options].some((o) => o.value === bill.currency)) {
      sel.appendChild(new Option(bill.currency, bill.currency));
    }
    sel.value = bill.currency;
    renderPeople();
    renderItems();
    renderSummary();
  }

  function renderPeople() {
    const wrap = $('people-list');
    wrap.textContent = '';
    for (const p of bill.people) {
      const chip = el('button', 'chip', personLabel(p));
      chip.type = 'button';
      if (p.payLink) chip.appendChild(el('span', 'paylink-mark', '💳'));
      chip.addEventListener('click', () => openPersonDialog({ mode: 'bill', id: p.id }));
      wrap.appendChild(chip);
    }
  }

  function renderItems() {
    const wrap = $('items-list');
    wrap.textContent = '';
    if (bill.items.length === 0) {
      wrap.appendChild(el('p', 'empty-note', 'No items yet. Add what was paid, item by item.'));
      return;
    }
    for (const item of bill.items) {
      const card = el('button', 'item-card');
      card.type = 'button';
      const main = el('div', 'item-main');
      main.appendChild(el('div', 'item-desc', item.desc));
      const n = item.sharedBy.length;
      const heads = item.sharedBy.reduce((sum, id) => {
        const p = personById(id);
        return p ? sum + headcountOf(p) : sum;
      }, 0);
      let meta = 'Paid by ' + personName(item.paidBy) + ' · split ' + (n === 1 ? 'by 1' : n + ' ways');
      if (heads !== n) meta += ' (' + formatHeadcount(heads) + ' shares)';
      main.appendChild(el('div', 'item-meta', meta));
      card.appendChild(main);
      card.appendChild(el('div', 'item-amount', fmt(item.amountCents)));
      card.addEventListener('click', () => openItemDialog(item.id));
      wrap.appendChild(card);
    }
  }

  function renderSummary() {
    const summary = $('summary-content');
    const transfersWrap = $('transfers-list');
    summary.textContent = '';
    transfersWrap.textContent = '';

    if (bill.people.length === 0 || bill.items.length === 0) {
      summary.appendChild(el('p', 'empty-note', 'Add people and items to see who owes what.'));
      $('transfers-heading').classList.add('hidden');
      return;
    }
    $('transfers-heading').classList.remove('hidden');

    const balances = L.computeBalances(bill);

    const table = el('table', 'summary-table');
    const thead = el('thead');
    const hr = el('tr');
    for (const h of ['Person / Family', 'Paid', 'Share', 'Net']) hr.appendChild(el('th', '', h));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const p of bill.people) {
      const b = balances[p.id];
      const tr = el('tr');
      tr.appendChild(el('td', '', p.name));
      tr.appendChild(el('td', '', fmt(b.paidCents)));
      tr.appendChild(el('td', '', fmt(b.owedCents)));
      const netTd = el('td', b.netCents > 0 ? 'net-pos' : b.netCents < 0 ? 'net-neg' : '',
        (b.netCents > 0 ? '+' : '') + fmt(b.netCents));
      tr.appendChild(netTd);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    const scroller = el('div', 'table-scroll');
    scroller.appendChild(table);
    summary.appendChild(scroller);

    const transfers = L.settle(balances);
    if (transfers.length === 0) {
      transfersWrap.appendChild(el('div', 'all-settled', 'All settled — nobody owes anything 🎉'));
      return;
    }
    const missingPayLink = new Set();
    for (const t of transfers) {
      const row = el('div', 'transfer-row');
      const who = el('div', 'transfer-who');
      who.appendChild(document.createTextNode(personName(t.from)));
      who.appendChild(el('span', 'arr', '→'));
      who.appendChild(document.createTextNode(personName(t.to)));
      row.appendChild(who);
      row.appendChild(el('div', 'transfer-amount', fmt(t.amountCents)));
      const actions = el('div', 'transfer-actions');
      const btn = el('button', 'btn small primary', 'Request');
      btn.type = 'button';
      btn.addEventListener('click', () => requestPayment(t));
      actions.appendChild(btn);

      const payee = personById(t.to);
      if (payee && payee.payLink) {
        const payBtn = el('a', 'btn small payme', 'PayMe');
        payBtn.href = normalizePayLink(payee.payLink);
        payBtn.target = '_blank';
        payBtn.rel = 'noopener';
        actions.appendChild(payBtn);
      } else if (payee) {
        missingPayLink.add(payee.name);
      }
      row.appendChild(actions);
      transfersWrap.appendChild(row);
    }
    if (missingPayLink.size > 0) {
      const names = [...missingPayLink].map((n) => '"' + n + '"').join(', ');
      transfersWrap.appendChild(el('p', 'transfer-hint',
        'Tip: tap ' + names + ' above and add their PayMe link to include it in requests.'));
    }
  }

  /* ---------- PayMe / sharing ---------- */

  function requestPayment(t) {
    const from = personById(t.from);
    const to = personById(t.to);
    if (!from || !to) return;
    let text = from.name + ', you owe ' + to.name + ' ' + fmt(t.amountCents) + ' for "' + bill.title + '"';
    const link = normalizePayLink(to.payLink);
    if (link) text += ' → Pay here: ' + link;
    shareText(text);
  }

  async function openShareDialog() {
    const payload = await L.encodeBill(bill);
    const base = location.href.split('#')[0];
    const url = base + '#b=' + payload;
    const text = 'Split bill "' + bill.title + '" — open this link to see the bill or add what you paid:\n' + url;

    $('share-link-preview').textContent = url;
    const nativeBtn = $('share-native');
    nativeBtn.classList.toggle('hidden', !navigator.share);
    nativeBtn.onclick = () => {
      navigator.share({ text }).catch(() => {});
    };
    $('share-whatsapp').href = 'https://wa.me/?text=' + encodeURIComponent(text);
    $('share-copy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      } catch (e) {
        toast('Could not copy — long-press the link to copy it');
      }
    };
    $('share-dialog').showModal();
  }

  /* ---------- Person dialog ---------- */

  function openPersonDialog(ctx) {
    personCtx = ctx;
    let p = null;
    if (ctx.id) {
      p = ctx.mode === 'contact' ? loadContacts().find((c) => c.id === ctx.id) : personById(ctx.id);
    }
    $('person-dialog-heading').textContent = p ? 'Edit person/family' : 'Add person/family';
    $('person-name').value = p ? p.name : '';
    $('person-headcount').value = formatHeadcount(p ? headcountOf(p) : 1);
    // First person ever on this device: prefill their remembered PayLink.
    const prefill = !p && loadContacts().length === 0 ? localStorage.getItem(LS_MY_PAYLINK) || '' : '';
    $('person-paylink').value = p ? p.payLink || '' : prefill;
    const del = $('person-delete');
    del.classList.toggle('hidden', !p);
    del.textContent = ctx.mode === 'bill' ? 'Remove' : 'Delete';
    setDialogFocus($('person-dialog'), $('person-name'), !p);
    $('person-dialog').showModal();
  }

  function stepHeadcount(delta) {
    const input = $('person-headcount');
    const h = Math.max(0.5, L.normalizeHeadcount(input.value) + delta);
    input.value = formatHeadcount(h);
  }

  function savePerson(e) {
    e.preventDefault();
    const name = $('person-name').value.trim();
    const payLink = $('person-paylink').value.trim();
    if (!name) {
      toast('Please enter a name');
      return;
    }
    const headcount = L.normalizeHeadcount($('person-headcount').value);
    const data = { name, payLink, headcount };
    const contacts = loadContacts();
    let id = personCtx.id;
    if (!id) {
      id = L.newId();
      if (contacts.length === 0 && payLink) {
        try { localStorage.setItem(LS_MY_PAYLINK, payLink); } catch (err) { /* ignore */ }
      }
      contacts.push({ id, ...data });
    } else {
      // Keep the pool entry (if any) in sync no matter where the edit started.
      const contact = contacts.find((c) => c.id === id);
      if (contact) Object.assign(contact, data);
    }
    saveContacts(contacts);
    // Keep this bill's copy in sync too.
    const billPerson = personById(id);
    if (billPerson) Object.assign(billPerson, data);
    else if (personCtx.addToBill) bill.people.push({ id, ...data });
    $('person-dialog').close();
    if ($('picker-dialog').open) $('picker-dialog').close();
    if ($('people-dialog').open) renderContactsList();
    saveBill();
    render();
  }

  function deletePerson() {
    const id = personCtx.id;
    if (personCtx.mode === 'bill') {
      const used = bill.items.some((it) => it.paidBy === id || it.sharedBy.includes(id));
      if (used) {
        toast('This person is on some items — edit those items first');
        return;
      }
      bill.people = bill.people.filter((p) => p.id !== id);
      $('person-dialog').close();
      saveBill();
      render();
    } else {
      const contact = loadContacts().find((c) => c.id === id);
      if (!confirm('Delete "' + (contact ? contact.name : '') + '" from your saved people? Existing bills are not affected.')) return;
      saveContacts(loadContacts().filter((c) => c.id !== id));
      $('person-dialog').close();
      if ($('people-dialog').open) renderContactsList();
    }
  }

  /* ---------- People picker (add pool contacts to the bill) ---------- */

  function openPicker() {
    const contacts = loadContacts();
    if (contacts.length === 0) {
      // Nothing to pick from yet — go straight to creating the first person.
      openPersonDialog({ mode: 'contact', id: null, addToBill: true });
      return;
    }
    pickerSelected = new Set();
    renderPickerList();
    $('picker-dialog').showModal();
  }

  function renderPickerList() {
    const wrap = $('picker-list');
    wrap.textContent = '';
    const inBill = new Set(bill.people.map((p) => p.id));
    const available = loadContacts().filter((c) => !inBill.has(c.id));
    const empty = $('picker-empty');
    empty.classList.toggle('hidden', available.length > 0);
    if (available.length === 0) {
      empty.textContent = 'Everyone you saved is already on this bill. Tap "＋ New" to add someone else.';
    }
    for (const c of available) {
      const chip = el('button', 'chip toggle', personLabel(c));
      chip.type = 'button';
      chip.setAttribute('aria-pressed', pickerSelected.has(c.id) ? 'true' : 'false');
      chip.addEventListener('click', () => {
        if (pickerSelected.has(c.id)) pickerSelected.delete(c.id);
        else pickerSelected.add(c.id);
        chip.setAttribute('aria-pressed', pickerSelected.has(c.id) ? 'true' : 'false');
      });
      wrap.appendChild(chip);
    }
  }

  function pickerAdd() {
    if (pickerSelected.size === 0) {
      toast('Tap the people you want to add');
      return;
    }
    for (const c of loadContacts()) {
      if (pickerSelected.has(c.id)) {
        bill.people.push({ id: c.id, name: c.name, payLink: c.payLink || '', headcount: L.normalizeHeadcount(c.headcount) });
      }
    }
    $('picker-dialog').close();
    saveBill();
    render();
  }

  /* ---------- People management ---------- */

  function renderContactsList() {
    const wrap = $('contacts-list');
    wrap.textContent = '';
    const contacts = loadContacts();
    if (contacts.length === 0) {
      wrap.appendChild(el('p', 'empty-note', 'No saved people yet.'));
      return;
    }
    for (const c of contacts) {
      const row = el('button', 'history-row');
      row.type = 'button';
      const main = el('div', 'history-main');
      main.appendChild(el('div', 'history-title', personLabel(c) + (c.payLink ? ' 💳' : '')));
      main.appendChild(el('div', 'history-meta', c.payLink || 'No PayMe link'));
      row.appendChild(main);
      row.addEventListener('click', () => openPersonDialog({ mode: 'contact', id: c.id }));
      wrap.appendChild(row);
    }
  }

  /* ---------- Item dialog ---------- */

  function openItemDialog(itemId) {
    if (bill.people.length === 0) {
      toast('Add at least one person/family first');
      openPicker();
      return;
    }
    editingItemId = itemId || null;
    const item = itemId ? bill.items.find((i) => i.id === itemId) : null;
    $('item-dialog-heading').textContent = item ? 'Edit item' : 'Add item';
    $('item-desc').value = item ? item.desc : '';
    $('item-amount').value = item ? (item.amountCents / 100).toFixed(2).replace(/\.00$/, '') : '';
    $('item-delete').classList.toggle('hidden', !item);

    const paidBySel = $('item-paidby');
    paidBySel.textContent = '';
    for (const p of bill.people) paidBySel.appendChild(new Option(p.name, p.id));
    paidBySel.value = item ? item.paidBy : bill.people[0].id;

    dialogShared = new Set(item ? item.sharedBy : bill.people.map((p) => p.id));
    renderSharedChips();

    setDialogFocus($('item-dialog'), $('item-amount'), !item);
    $('item-dialog').showModal();
  }

  function renderSharedChips() {
    const wrap = $('item-sharedby');
    wrap.textContent = '';
    for (const p of bill.people) {
      const chip = el('button', 'chip toggle', personLabel(p));
      chip.type = 'button';
      chip.setAttribute('aria-pressed', dialogShared.has(p.id) ? 'true' : 'false');
      chip.addEventListener('click', () => {
        if (dialogShared.has(p.id)) dialogShared.delete(p.id);
        else dialogShared.add(p.id);
        chip.setAttribute('aria-pressed', dialogShared.has(p.id) ? 'true' : 'false');
      });
      wrap.appendChild(chip);
    }
  }

  function saveItem(e) {
    e.preventDefault();
    const desc = $('item-desc').value.trim() || 'Item';
    const amountCents = L.parseAmountToCents($('item-amount').value);
    if (amountCents === null || amountCents <= 0) {
      toast('Please enter a valid amount');
      $('item-amount').focus();
      return;
    }
    if (dialogShared.size === 0) {
      toast('Pick at least one person to split between');
      return;
    }
    const paidBy = $('item-paidby').value;
    const sharedBy = bill.people.filter((p) => dialogShared.has(p.id)).map((p) => p.id);
    if (editingItemId) {
      const item = bill.items.find((i) => i.id === editingItemId);
      Object.assign(item, { desc, amountCents, paidBy, sharedBy });
    } else {
      bill.items.push({ id: L.newId(), desc, amountCents, paidBy, sharedBy });
    }
    $('item-dialog').close();
    saveBill();
    render();
  }

  function deleteItem() {
    bill.items = bill.items.filter((i) => i.id !== editingItemId);
    $('item-dialog').close();
    saveBill();
    render();
  }

  /* ---------- History ---------- */

  function openHistoryDialog() {
    const wrap = $('history-list');
    wrap.textContent = '';
    const bills = Object.values(loadBills()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (bills.length === 0) wrap.appendChild(el('p', 'empty-note', 'No saved bills yet.'));
    for (const b of bills) {
      const row = el('button', 'history-row' + (b.id === bill.id ? ' current' : ''));
      row.type = 'button';
      const main = el('div', 'history-main');
      main.appendChild(el('div', 'history-title', b.title));
      const total = (b.items || []).reduce((s, i) => s + i.amountCents, 0);
      const date = new Date(b.updatedAt || 0).toLocaleDateString();
      main.appendChild(el('div', 'history-meta',
        date + ' · ' + (b.people || []).length + ' people · ' + L.formatMoney(total, b.currency || 'HKD')));
      row.appendChild(main);
      const del = el('button', 'history-delete', '🗑');
      del.type = 'button';
      del.setAttribute('aria-label', 'Delete bill');
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm('Delete bill "' + b.title + '"?')) return;
        const all = loadBills();
        delete all[b.id];
        localStorage.setItem(LS_BILLS, JSON.stringify(all));
        if (b.id === bill.id) {
          bill = newBill();
          saveBill();
          render();
        }
        openHistoryDialog();
      });
      row.appendChild(del);
      row.addEventListener('click', () => {
        bill = b;
        localStorage.setItem(LS_CURRENT, bill.id);
        $('history-dialog').close();
        render();
      });
      wrap.appendChild(row);
    }
  }

  /* ---------- Events / init ---------- */

  function bindEvents() {
    $('bill-title').addEventListener('change', () => {
      bill.title = $('bill-title').value.trim() || defaultTitle();
      $('bill-title').value = bill.title;
      saveBill();
    });
    $('currency-select').addEventListener('change', () => {
      bill.currency = $('currency-select').value;
      saveBill();
      render();
    });
    $('btn-add-person').addEventListener('click', openPicker);
    $('picker-new').addEventListener('click', () => openPersonDialog({ mode: 'contact', id: null, addToBill: true }));
    $('picker-add').addEventListener('click', pickerAdd);
    $('btn-people').addEventListener('click', () => {
      renderContactsList();
      $('people-dialog').showModal();
    });
    $('contact-new').addEventListener('click', () => openPersonDialog({ mode: 'contact', id: null }));
    $('paylink-paste').addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        const link = L.extractPayLink(text);
        if (!link) {
          toast('No link found in the clipboard');
          return;
        }
        $('person-paylink').value = link;
        toast('PayMe link pasted');
      } catch (err) {
        toast("Couldn't read the clipboard — paste it manually");
      }
    });
    $('btn-add-item').addEventListener('click', () => openItemDialog(null));
    $('btn-share').addEventListener('click', openShareDialog);
    $('btn-history').addEventListener('click', () => {
      openHistoryDialog();
      $('history-dialog').showModal();
    });
    $('btn-new-bill').addEventListener('click', () => {
      bill = newBill();
      saveBill();
      $('history-dialog').close();
      render();
    });
    $('person-form').addEventListener('submit', savePerson);
    $('person-delete').addEventListener('click', deletePerson);
    $('headcount-minus').addEventListener('click', () => stepHeadcount(-0.5));
    $('headcount-plus').addEventListener('click', () => stepHeadcount(0.5));
    $('item-form').addEventListener('submit', saveItem);
    $('item-delete').addEventListener('click', deleteItem);

    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => btn.closest('dialog').close());
    });
    // Tap outside a dialog to close it.
    document.querySelectorAll('dialog').forEach((d) => {
      d.addEventListener('click', (e) => {
        if (e.target === d) d.close();
      });
    });
  }

  // Returns true if the URL hash held a valid shared bill and it was loaded.
  async function loadFromHash() {
    const m = location.hash.match(/^#b=(.+)$/);
    if (!m) return false;
    try {
      const loaded = await L.decodeBill(decodeURIComponent(m[1]));
      if (!loaded.id) loaded.id = L.newId();
      bill = loaded;
      saveBill();
      history.replaceState(null, '', location.pathname + location.search);
      toast('Bill loaded from link');
      return true;
    } catch (e) {
      toast('Could not read that bill link');
      return false;
    }
  }

  async function init() {
    seedContactsIfNeeded();
    await loadFromHash();
    if (!bill) {
      const bills = loadBills();
      const currentId = localStorage.getItem(LS_CURRENT);
      bill = (currentId && bills[currentId]) || newBill();
    }
    bindEvents();
    render();

    // Opening a shared link while the app is already open only changes the
    // hash (same-document navigation), so handle it here too.
    window.addEventListener('hashchange', async () => {
      if (await loadFromHash()) {
        document.querySelectorAll('dialog[open]').forEach((d) => d.close());
        render();
      }
    });
  }

  init();
})();
