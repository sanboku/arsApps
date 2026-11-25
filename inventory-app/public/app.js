'use strict';

/* ---------- 共通ユーティリティ ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const yen = (n) => `¥${Number(n || 0).toLocaleString('ja-JP')}`;
const fmt = (n) => Number(n || 0).toLocaleString('ja-JP');
const KIND_LABEL = {
  transfer: '拠点間移動', sample_out: 'サンプル払出', sample_return: 'サンプル返却',
  receipt: '入庫', adjust: '在庫調整', invoice_issue: '請求出荷', invoice_void: '請求取消',
};
const STATUS_LABEL = { draft: '下書き', issued: '発行済', paid: '入金済', void: '取消' };

const TOKEN_KEY = 'inventory-token';
const readToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const writeToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* 保存できない環境 */ } };

async function api(method, path, body) {
  const opts = { method, headers: {} };
  const token = readToken();
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* 空レスポンス */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `通信エラー (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------- ログイン状態 ---------- */
let currentUser = null;
const isAdmin = () => !!currentUser && currentUser.role === 'admin';

async function checkSession() {
  if (!readToken()) return false;
  try {
    currentUser = await api('GET', '/api/auth/me');
    return true;
  } catch {
    currentUser = null;
    return false;
  }
}

function renderUserBar() {
  const bar = $('#user-bar');
  bar.hidden = !currentUser;
  if (currentUser) {
    $('#user-name').textContent = `${currentUser.name}(${currentUser.code} / ${currentUser.role === 'admin' ? '管理者' : '一般'})`;
  }
}

/** 初回は管理者の作成、2回目以降はログイン画面 */
async function renderAuth(view) {
  const st = await api('GET', '/api/auth/status');
  const setup = !st.initialized;
  renderUserBar();
  view.innerHTML = `
    <section class="card auth-card">
      <h2>${setup ? '初期設定(管理者の作成)' : 'ログイン'}</h2>
      ${setup ? '<p class="muted">最初の管理者アカウントを作成します。作成後はそのままログインされます。</p>' : ''}
      <form id="auth-form">
        <label>従業員ID<input name="code" autocomplete="username" autocapitalize="characters" required maxlength="20"></label>
        ${setup ? '<label>氏名<input name="name" autocomplete="name" required maxlength="50"></label>' : ''}
        <label>PIN(4〜6桁)<input name="pin" type="password" inputmode="numeric" pattern="\\d{4,6}" autocomplete="current-password" required maxlength="6"></label>
        <button type="submit" class="block">${setup ? '管理者を作成' : 'ログイン'}</button>
      </form>
    </section>`;
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api('POST', setup ? '/api/auth/setup' : '/api/auth/login', fd);
      writeToken(r.token);
      currentUser = r.employee;
      toast(`${currentUser.name} さん、ようこそ`);
      route();
    } catch (err) { toast(err.message, true); }
  });
}

$('#logout-btn').addEventListener('click', async () => {
  try { await api('POST', '/api/auth/logout', {}); } catch { /* 失効済みでも続行 */ }
  writeToken(null);
  currentUser = null;
  route();
});

$('#pin-btn').addEventListener('click', () => {
  const dlg = $('#pin-dialog');
  $('#pin-form').reset();
  dlg.showModal();
});
$('#pin-cancel').addEventListener('click', () => $('#pin-dialog').close());
$('#pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  if (fd.new_pin !== fd.confirm_pin) return toast('新しいPINが一致しません', true);
  try {
    await api('POST', '/api/auth/pin', { current_pin: fd.current_pin, new_pin: fd.new_pin });
    $('#pin-dialog').close();
    toast('PINを変更しました');
  } catch (err) { toast(err.message, true); }
});

let toastTimer;
function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast${isError ? ' error' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

function addDaysJS(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
const todayISO = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* ---------- マスタのキャッシュ ---------- */
const masters = { locations: [], products: [], customers: [], employees: [] };
const activeOnly = (list) => list.filter((x) => x.active);

async function loadMasters() {
  [masters.locations, masters.products, masters.customers] = await Promise.all([
    api('GET', '/api/locations?all=1'),
    api('GET', '/api/products?all=1'),
    api('GET', '/api/customers?all=1'),
  ]);
  masters.employees = isAdmin() ? await api('GET', '/api/employees') : [];
}

function options(list, selected, label, placeholder) {
  const head = placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '';
  return head + list.map((x) => `<option value="${x.id}"${String(x.id) === String(selected) ? ' selected' : ''}>${esc(label(x))}</option>`).join('');
}

/* ---------- 明細行エディタ(移動・請求書で共用) ---------- */
function lineEditor(container, initial, { withPrice = false, onChange = () => {} } = {}) {
  let lines = initial.map((l) => ({ ...l }));
  const productOptions = (sel) => options(activeOnly(masters.products), sel, (p) => `${p.sku} ${p.name}`, '品目を選択');

  const render = () => {
    container.innerHTML = lines.length === 0
      ? '<p class="muted">明細がありません</p>'
      : lines.map((l, i) => `
        <div class="row line-grid" data-i="${i}" style="margin-bottom:8px">
          <select data-f="product_id" style="flex:2;min-width:200px">${productOptions(l.product_id)}</select>
          <input type="number" min="1" step="1" data-f="qty" value="${esc(l.qty)}" aria-label="数量">
          ${withPrice ? `<input type="number" min="0" step="1" data-f="unit_price" value="${esc(l.unit_price)}" aria-label="単価">` : ''}
          <button type="button" class="ghost small danger" data-remove="${i}">削除</button>
        </div>`).join('');
  };

  container.addEventListener('change', (e) => {
    const row = e.target.closest('[data-i]');
    if (!row) return;
    const i = Number(row.dataset.i);
    const field = e.target.dataset.f;
    lines[i][field] = e.target.value;
    if (field === 'product_id' && withPrice) {
      const p = masters.products.find((x) => String(x.id) === e.target.value);
      if (p) lines[i].unit_price = p.unit_price;
      render();
    }
    onChange();
  });
  container.addEventListener('input', (e) => {
    const row = e.target.closest('[data-i]');
    if (!row || !e.target.dataset.f) return;
    lines[Number(row.dataset.i)][e.target.dataset.f] = e.target.value;
    onChange();
  });
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    lines.splice(Number(btn.dataset.remove), 1);
    render();
    onChange();
  });

  render();
  return {
    values: () => lines
      .filter((l) => l.product_id)
      .map((l) => ({
        product_id: Number(l.product_id),
        qty: Number(l.qty) || 0,
        ...(withPrice ? { unit_price: l.unit_price === '' ? 0 : Number(l.unit_price) } : {}),
      })),
    add: () => { lines.push({ product_id: '', qty: 1, unit_price: '' }); render(); onChange(); },
  };
}

/* ---------- 在庫 ---------- */
async function renderStock(view) {
  const s = await api('GET', '/api/stock');
  const locs = s.locations;
  const cell = new Map();
  const heldAtCustomers = new Map();
  for (const b of s.balances) {
    if (b.location_id != null) cell.set(`${b.product_id}:${b.location_id}`, b.qty);
    else heldAtCustomers.set(b.product_id, (heldAtCustomers.get(b.product_id) || 0) + b.qty);
  }
  const qtyCell = (q) => (q ? `<span>${fmt(q)}</span>` : '<span class="zero">–</span>');

  view.innerHTML = `
    <section class="card">
      <h2>在庫一覧</h2>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>SKU</th><th>品名</th><th>単位</th>
          ${locs.map((l) => `<th class="num">${esc(l.name)}</th>`).join('')}
          <th class="num">拠点合計</th><th class="num">お客様保有</th>
        </tr></thead>
        <tbody>${s.products.length === 0 ? `<tr><td colspan="${locs.length + 5}" class="muted">品目がありません。マスタから登録してください。</td></tr>` :
          s.products.map((p) => {
            let total = 0;
            const cols = locs.map((l) => { const q = cell.get(`${p.id}:${l.id}`) || 0; total += q; return `<td class="num">${qtyCell(q)}</td>`; }).join('');
            const held = heldAtCustomers.get(p.id) || 0;
            return `<tr><td>${esc(p.sku)}</td><td>${esc(p.name)}</td><td>${esc(p.unit)}</td>${cols}
              <td class="num"><strong>${fmt(total)}</strong></td><td class="num">${qtyCell(held)}</td></tr>`;
          }).join('')}
        </tbody>
      </table></div>
    </section>

    <section class="card">
      <h2>入庫・在庫調整</h2>
      <form id="adjust-form" class="grid" style="grid-template-columns: repeat(auto-fit, minmax(160px,1fr)); align-items:end">
        <label>拠点<select name="location_id" required>${options(activeOnly(locs), '', (l) => l.name, '拠点を選択')}</select></label>
        <label>品目<select name="product_id" required>${options(activeOnly(s.products), '', (p) => `${p.sku} ${p.name}`, '品目を選択')}</select></label>
        <label>数量(マイナスで減少)<input type="number" name="qty" step="1" required></label>
        <label>備考<input type="text" name="note" maxlength="500"></label>
        <div><button type="submit">登録</button></div>
      </form>
      <p class="muted">正の数量は入庫、負の数量は在庫調整による出庫です。在庫を超える出庫は登録できません。</p>
    </section>

    <section class="card">
      <h2>サンプル貸出中</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>お客様</th><th>SKU</th><th>品名</th><th class="num">貸出数</th></tr></thead>
        <tbody>${s.sample_loans.length === 0 ? '<tr><td colspan="4" class="muted">貸出中のサンプルはありません</td></tr>' :
          s.sample_loans.map((x) => `<tr><td>${esc(x.customer_name)}</td><td>${esc(x.sku)}</td><td>${esc(x.product_name)}</td><td class="num">${fmt(x.qty)} ${esc(x.unit)}</td></tr>`).join('')}
        </tbody>
      </table></div>
    </section>

    <section class="card">
      <h2>在庫移動履歴 <span class="muted">(最新200件)</span></h2>
      <div class="table-wrap"><table>
        <thead><tr><th>日時</th><th>区分</th><th>SKU / 品名</th><th>保持先</th><th class="num">増減</th><th>備考</th></tr></thead>
        <tbody id="movement-rows"><tr><td colspan="6" class="muted">読み込み中…</td></tr></tbody>
      </table></div>
    </section>`;

  $('#adjust-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    try {
      await api('POST', '/api/stock/adjustments', { location_id: fd.location_id, product_id: fd.product_id, qty: Number(fd.qty), note: fd.note });
      toast('登録しました');
      route();
    } catch (err) { toast(err.message, true); }
  });

  const moves = await api('GET', '/api/movements');
  $('#movement-rows').innerHTML = moves.length === 0
    ? '<tr><td colspan="6" class="muted">履歴はありません</td></tr>'
    : moves.map((m) => `<tr>
        <td class="muted">${esc(m.created_at)}</td>
        <td><span class="badge">${esc(KIND_LABEL[m.kind] || m.kind)}</span></td>
        <td>${esc(m.sku)} ${esc(m.product_name)}</td>
        <td>${esc(m.location_name || m.customer_name || '')}</td>
        <td class="num ${m.qty < 0 ? 'neg' : ''}">${m.qty > 0 ? '+' : ''}${fmt(m.qty)}</td>
        <td class="muted">${esc(m.note)}</td></tr>`).join('');
}

/* ---------- 在庫移動・サンプル ---------- */
const TRANSFER_FIELDS = {
  from_location_id: ['transfer', 'sample_out'],
  to_location_id: ['transfer', 'sample_return'],
  customer_id: ['sample_out', 'sample_return'],
};

async function renderTransfers(view) {
  const history = await api('GET', '/api/transfers');
  const locs = activeOnly(masters.locations);
  const customers = activeOnly(masters.customers);
  const locOpts = (sel) => options(locs, sel, (l) => l.name, '拠点を選択');

  view.innerHTML = `
    <section class="card">
      <h2>在庫移動・サンプル処理</h2>
      <form id="transfer-form">
        <div class="grid">
          <label>操作
            <select name="kind">
              <option value="transfer">拠点間移動</option>
              <option value="sample_out">サンプル払出(拠点→お客様)</option>
              <option value="sample_return">サンプル返却(お客様→拠点)</option>
            </select>
          </label>
          <label data-fields="from_location_id">移動元拠点<select name="from_location_id">${locOpts('')}</select></label>
          <label data-fields="to_location_id">移動先拠点<select name="to_location_id">${locOpts('')}</select></label>
          <label data-fields="customer_id">お客様<select name="customer_id">${options(customers, '', (c) => c.name, 'お客様を選択')}</select></label>
        </div>
        <h3>品目</h3>
        <div id="transfer-lines"></div>
        <div class="row" style="margin:8px 0 12px"><button type="button" class="ghost small" id="add-transfer-line">+ 品目を追加</button></div>
        <label>備考<input type="text" name="note" maxlength="500"></label>
        <p class="muted" id="transfer-hint"></p>
        <div class="row"><span class="spacer"></span><button type="submit">登録</button></div>
      </form>
    </section>

    <section class="card">
      <h2>移動履歴 <span class="muted">(最新100件)</span></h2>
      <div class="table-wrap"><table>
        <thead><tr><th>日時</th><th>操作</th><th>経路</th><th>品目</th><th>備考</th></tr></thead>
        <tbody>${history.length === 0 ? '<tr><td colspan="5" class="muted">履歴はありません</td></tr>' : history.map((t) => {
          const route = t.kind === 'transfer' ? `${t.from_location_name} → ${t.to_location_name}`
            : t.kind === 'sample_out' ? `${t.from_location_name} → ${t.customer_name}(サンプル)`
            : `${t.customer_name}(サンプル) → ${t.to_location_name}`;
          return `<tr>
            <td class="muted">${esc(t.created_at)}</td>
            <td><span class="badge">${esc(t.kind_label)}</span></td>
            <td>${esc(route)}</td>
            <td>${t.lines.map((l) => `${esc(l.name)} × ${fmt(l.qty)}${esc(l.unit)}`).join('<br>')}</td>
            <td class="muted">${esc(t.note)}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>`;

  const form = $('#transfer-form');
  const kindSel = form.elements.kind;
  const applyKind = () => {
    const kind = kindSel.value;
    form.querySelectorAll('[data-fields]').forEach((el) => {
      el.hidden = !TRANSFER_FIELDS[el.dataset.fields].includes(kind);
    });
    const hints = {
      transfer: '在庫は移動元から移動先へ移ります。移動元の在庫が不足すると登録できません。',
      sample_out: 'サンプルを拠点からお客様へ渡します。お客様の保有数として記録されます。',
      sample_return: 'お客様が返却したサンプルを拠点へ戻します。お客様の貸出残を超える数量は登録できません。',
    };
    $('#transfer-hint').textContent = hints[kind];
  };
  kindSel.addEventListener('change', applyKind);
  applyKind();

  const editor = lineEditor($('#transfer-lines'), [{ product_id: '', qty: 1 }]);
  $('#add-transfer-line').addEventListener('click', () => editor.add());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const lines = editor.values();
    if (lines.length === 0) return toast('品目を1行以上入力してください', true);
    try {
      await api('POST', '/api/transfers', {
        kind: fd.kind,
        from_location_id: fd.from_location_id,
        to_location_id: fd.to_location_id,
        customer_id: fd.customer_id,
        note: fd.note,
        lines,
      });
      toast('登録しました');
      route();
    } catch (err) { toast(err.message, true); }
  });
}

/* ---------- 請求書 ---------- */
const invUI = { mode: 'list', filter: '', draft: null };

async function renderInvoices(view) {
  if (invUI.mode === 'edit') return renderInvoiceForm(view);

  const list = await api('GET', `/api/invoices${invUI.filter ? `?status=${encodeURIComponent(invUI.filter)}` : ''}`);
  const actions = (inv) => {
    const b = [`<button class="ghost small" data-act="view" data-id="${inv.id}">詳細</button>`];
    if (inv.status === 'draft') b.push(
      `<button class="ghost small" data-act="edit" data-id="${inv.id}">編集</button>`,
      `<button class="small" data-act="issue" data-id="${inv.id}">発行</button>`,
      `<button class="ghost small danger" data-act="delete" data-id="${inv.id}">削除</button>`);
    if (inv.status === 'issued') b.push(`<button class="small" data-act="paid" data-id="${inv.id}">入金済にする</button>`);
    if (inv.status === 'issued' || inv.status === 'paid') b.push(`<button class="ghost small danger" data-act="void" data-id="${inv.id}">取消</button>`);
    return b.join(' ');
  };

  view.innerHTML = `
    <section class="card">
      <div class="row">
        <h2 style="margin:0">請求書</h2>
        <span class="spacer"></span>
        <select id="inv-filter" aria-label="状態で絞り込み">
          ${[['', 'すべての状態'], ['draft', '下書き'], ['issued', '発行済'], ['paid', '入金済'], ['void', '取消']]
            .map(([v, l]) => `<option value="${v}"${v === invUI.filter ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <button id="new-invoice">新規作成</button>
      </div>
    </section>
    <section class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>番号</th><th>発行日</th><th>支払期日</th><th>取引先</th><th>出荷拠点</th><th class="num">合計</th><th>状態</th><th>操作</th></tr></thead>
        <tbody id="inv-rows">${list.length === 0 ? '<tr><td colspan="8" class="muted">請求書がありません</td></tr>' : list.map((i) => `<tr>
          <td>${esc(i.number || '(未発行)')}</td>
          <td>${esc(i.issue_date)}</td>
          <td>${esc(i.due_date)}</td>
          <td>${esc(i.customer_name)}</td>
          <td>${esc(i.location_name)}</td>
          <td class="num">${yen(i.total)}</td>
          <td><span class="badge ${i.status}">${esc(i.status_label)}</span></td>
          <td style="white-space:nowrap">${actions(i)}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>`;

  $('#inv-filter').addEventListener('change', (e) => { invUI.filter = e.target.value; route(); });
  $('#new-invoice').addEventListener('click', () => { invUI.mode = 'edit'; invUI.draft = null; route(); });
  $('#inv-rows').addEventListener('click', onInvoiceAction);
}

async function onInvoiceAction(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  try {
    if (act === 'view') return openInvoiceDialog(id);
    if (act === 'edit') {
      invUI.mode = 'edit';
      invUI.draft = await api('GET', `/api/invoices/${id}`);
      return route();
    }
    if (act === 'delete') {
      if (!confirm('この下書きを削除しますか?')) return;
      await api('DELETE', `/api/invoices/${id}`);
      toast('削除しました');
    } else if (act === 'issue') {
      if (!confirm('請求書を発行します。出荷拠点の在庫を明細数量分減らします。よろしいですか?')) return;
      const inv = await api('POST', `/api/invoices/${id}/issue`);
      toast(`${inv.number} を発行しました`);
    } else if (act === 'paid') {
      await api('POST', `/api/invoices/${id}/paid`);
      toast('入金済にしました');
    } else if (act === 'void') {
      if (!confirm('この請求書を取り消します。出荷した在庫は拠点に戻ります。よろしいですか?')) return;
      await api('POST', `/api/invoices/${id}/void`);
      toast('取り消しました。在庫を戻しました');
    }
    route();
  } catch (err) {
    toast(err.message, true);
  }
}

async function renderInvoiceForm(view) {
  const draft = invUI.draft;
  const isNew = !draft;
  const issueDefault = draft ? draft.issue_date : todayISO();
  const dueDefault = draft ? draft.due_date : addDaysJS(issueDefault, 30);
  const customers = activeOnly(masters.customers);
  const locs = activeOnly(masters.locations);

  view.innerHTML = `
    <section class="card">
      <div class="row">
        <h2 style="margin:0">${isNew ? '請求書の新規作成' : '請求書の編集(下書き)'}</h2>
        <span class="spacer"></span>
        <button type="button" class="ghost" id="inv-back">一覧へ戻る</button>
      </div>
    </section>
    <form id="inv-form" class="card">
      <div class="grid">
        <label>取引先<select name="customer_id" required>${options(customers, draft?.customer_id, (c) => c.name, '取引先を選択')}</select></label>
        <label>出荷拠点(在庫を引き当て)<select name="location_id" required>${options(locs, draft?.location_id, (l) => l.name, '拠点を選択')}</select></label>
        <label>発行日<input type="date" name="issue_date" value="${esc(issueDefault)}" required></label>
        <label>支払期日<input type="date" name="due_date" value="${esc(dueDefault)}" required></label>
      </div>
      <h3>明細</h3>
      <div id="inv-lines"></div>
      <div class="row" style="margin:8px 0 12px"><button type="button" class="ghost small" id="inv-add-line">+ 明細を追加</button></div>
      <label>備考<textarea name="note" maxlength="500">${esc(draft?.note || '')}</textarea></label>
      <div class="inv-summary" style="margin:16px 0 0 auto;max-width:300px">
        <div class="row" style="justify-content:space-between"><span class="muted">小計</span><span id="sum-sub" class="num">¥0</span></div>
        <div class="row" style="justify-content:space-between"><span class="muted">消費税(10%)</span><span id="sum-tax" class="num">¥0</span></div>
        <div class="row" style="justify-content:space-between"><strong>合計</strong><strong id="sum-total" class="num">¥0</strong></div>
        <p class="muted" style="margin:4px 0 0">※ 表示は概算です。確定値は保存後に反映されます。</p>
      </div>
      <div class="row" style="margin-top:16px"><span class="spacer"></span>
        <button type="submit">下書きとして保存</button>
      </div>
    </form>`;

  const recalc = () => {
    const vals = editor.values();
    const sub = vals.reduce((s, l) => s + l.qty * l.unit_price, 0);
    const tax = Math.floor(sub * 0.1);
    $('#sum-sub').textContent = yen(sub);
    $('#sum-tax').textContent = yen(tax);
    $('#sum-total').textContent = yen(sub + tax);
  };
  const initial = draft
    ? draft.lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: l.unit_price }))
    : [{ product_id: '', qty: 1, unit_price: '' }];
  const editor = lineEditor($('#inv-lines'), initial, { withPrice: true, onChange: recalc });
  $('#inv-add-line').addEventListener('click', () => editor.add());
  recalc();

  $('#inv-back').addEventListener('click', () => { invUI.mode = 'list'; invUI.draft = null; route(); });

  $('#inv-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const body = {
      customer_id: fd.customer_id,
      location_id: fd.location_id,
      issue_date: fd.issue_date,
      due_date: fd.due_date,
      note: fd.note,
      lines: editor.values(),
    };
    try {
      if (isNew) await api('POST', '/api/invoices', body);
      else await api('PUT', `/api/invoices/${draft.id}`, body);
      toast('下書きを保存しました');
      invUI.mode = 'list';
      invUI.draft = null;
      route();
    } catch (err) { toast(err.message, true); }
  });
}

async function openInvoiceDialog(id) {
  const inv = await api('GET', `/api/invoices/${id}`);
  $('#invoice-print').innerHTML = `
    <h2>請求書</h2>
    <div class="inv-meta">
      <div><div class="to">${esc(inv.customer_name)} 御中</div><div>${esc(inv.customer_address)}</div></div>
      <div style="text-align:right">
        <div>請求書番号: ${esc(inv.number || '(未発行)')}</div>
        <div>発行日: ${esc(inv.issue_date)}</div>
        <div>支払期日: ${esc(inv.due_date)}</div>
        <div>出荷拠点: ${esc(inv.location_name)}</div>
        <div>状態: ${esc(inv.status_label)}</div>
      </div>
    </div>
    <table>
      <thead><tr><th>SKU</th><th>品名</th><th class="num">数量</th><th class="num">単価</th><th class="num">金額</th></tr></thead>
      <tbody>${inv.lines.map((l) => `<tr><td>${esc(l.sku)}</td><td>${esc(l.product_name)}</td>
        <td class="num">${fmt(l.qty)} ${esc(l.unit)}</td><td class="num">${yen(l.unit_price)}</td><td class="num">${yen(l.amount)}</td></tr>`).join('')}</tbody>
    </table>
    <div class="inv-totals">
      <div><span>小計</span><span>${yen(inv.subtotal)}</span></div>
      <div><span>消費税(10%)</span><span>${yen(inv.tax)}</span></div>
      <div class="grand"><span>合計</span><span>${yen(inv.total)}</span></div>
    </div>
    ${inv.note ? `<p style="margin-top:16px;white-space:pre-wrap">備考: ${esc(inv.note)}</p>` : ''}`;
  $('#invoice-dialog').showModal();
}

/* ---------- マスタ ---------- */
const MASTER_DEFS = {
  employees: {
    title: '従業員', endpoint: '/api/employees', items: () => masters.employees, adminOnly: true,
    columns: [['code', '従業員ID'], ['name', '氏名'], ['role', '権限', (v) => (v === 'admin' ? '管理者' : '一般')]],
    fields: [
      { name: 'code', label: '従業員ID(英数字)', required: true, max: 20, lockOnEdit: true },
      { name: 'name', label: '氏名', required: true, max: 50 },
      { name: 'role', label: '権限', select: [['staff', '一般'], ['admin', '管理者']] },
      { name: 'pin', label: 'PIN(4〜6桁)', type: 'password', inputmode: 'numeric', max: 6, requiredOnCreate: true, hint: '編集時は空欄なら変更しません' },
    ],
  },
  locations: {
    title: '拠点', endpoint: '/api/locations', items: () => masters.locations,
    columns: [['code', 'コード'], ['name', '拠点名'], ['address', '住所']],
    fields: [
      { name: 'code', label: '拠点コード', required: true, max: 20 },
      { name: 'name', label: '拠点名', required: true, max: 100 },
      { name: 'address', label: '住所', max: 200 },
    ],
  },
  products: {
    title: '品目', endpoint: '/api/products', items: () => masters.products,
    columns: [['sku', 'SKU'], ['name', '品名'], ['unit', '単位'], ['unit_price', '標準単価', (v) => yen(v)]],
    fields: [
      { name: 'sku', label: 'SKU', required: true, max: 40 },
      { name: 'name', label: '品名', required: true, max: 100 },
      { name: 'unit', label: '単位', max: 10, placeholder: '個' },
      { name: 'unit_price', label: '標準単価(円)', type: 'number', min: 0 },
    ],
  },
  customers: {
    title: '取引先', endpoint: '/api/customers', items: () => masters.customers,
    columns: [['name', '取引先名'], ['address', '住所'], ['email', 'メール']],
    fields: [
      { name: 'name', label: '取引先名', required: true, max: 100 },
      { name: 'address', label: '住所', max: 200 },
      { name: 'email', label: 'メール', max: 100 },
    ],
  },
};
const masterEditing = { locations: null, products: null, customers: null };

function renderMasterSection(key) {
  const def = MASTER_DEFS[key];
  const items = def.items();
  const editing = items.find((x) => x.id === masterEditing[key]) || null;
  return `
    <section class="card" data-master="${key}">
      <h2>${def.title}</h2>
      <div class="table-wrap"><table>
        <thead><tr>${def.columns.map(([, l]) => `<th>${l}</th>`).join('')}<th>状態</th></tr></thead>
        <tbody>${items.length === 0 ? `<tr><td colspan="${def.columns.length + 1}" class="muted">未登録です</td></tr>` : items.map((x) => `
          <tr class="clickable" data-edit="${x.id}">
            ${def.columns.map(([k, , f]) => `<td>${esc(f ? f(x[k]) : x[k])}</td>`).join('')}
            <td>${x.active ? '<span class="badge">有効</span>' : '<span class="badge void">無効</span>'}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      <h3>${editing ? `${def.title}を編集: ${esc(editing[def.columns[0][0]])}` : `${def.title}を新規登録`}</h3>
      <form data-form="${key}">
        <div class="grid">
          ${def.fields.map((f) => {
            const required = f.required || (f.requiredOnCreate && !editing);
            const disabled = f.lockOnEdit && editing ? 'disabled' : '';
            if (f.select) {
              return `<label>${f.label}
                <select name="${f.name}" ${disabled}>${f.select.map(([v, l]) =>
                  `<option value="${v}"${editing && String(editing[f.name]) === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
            }
            const value = f.type === 'password' ? '' : esc(editing ? editing[f.name] : '');
            return `<label>${f.label}
              <input name="${f.name}" type="${f.type || 'text'}" ${f.type === 'number' ? 'min="0" step="1"' : ''}
                ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} ${required ? 'required' : ''} ${disabled}
                ${f.max ? `maxlength="${f.max}"` : ''} ${f.placeholder ? `placeholder="${f.placeholder}"` : ''}
                value="${value}">${f.hint ? `<span class="muted">${esc(f.hint)}</span>` : ''}</label>`;
          }).join('')}
          ${editing ? `<label class="row" style="flex-direction:row;align-items:center;color:var(--text)"><input type="checkbox" name="active" ${editing.active ? 'checked' : ''}> 有効</label>` : ''}
        </div>
        <div class="row" style="margin-top:12px">
          ${editing ? '<button type="button" class="ghost" data-reset>新規登録に戻す</button>' : ''}
          <span class="spacer"></span>
          <button type="submit">${editing ? '更新' : '登録'}</button>
        </div>
      </form>
    </section>`;
}

async function renderMasters(view) {
  const keys = Object.keys(MASTER_DEFS).filter((k) => !MASTER_DEFS[k].adminOnly || isAdmin());
  view.innerHTML = keys.map(renderMasterSection).join('');
  view.querySelectorAll('[data-master]').forEach((section) => {
    const key = section.dataset.master;
    const def = MASTER_DEFS[key];
    section.addEventListener('click', (e) => {
      const row = e.target.closest('[data-edit]');
      if (row) {
        masterEditing[key] = Number(row.dataset.edit);
        return renderMasters(view).then(() => section.scrollIntoView({ block: 'nearest' }));
      }
      if (e.target.closest('[data-reset]')) {
        masterEditing[key] = null;
        renderMasters(view);
      }
    });
    section.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const body = {};
      for (const f of def.fields) {
        const value = form.elements[f.name].value;
        if (f.type === 'password' && !value) continue; // 編集時の空欄は変更なし
        body[f.name] = value;
      }
      if (form.elements.active) body.active = form.elements.active.checked;
      const id = masterEditing[key];
      try {
        await api(id ? 'PUT' : 'POST', id ? `${def.endpoint}/${id}` : def.endpoint, body);
        toast(`${def.title}を保存しました`);
        masterEditing[key] = null;
        await loadMasters();
        renderMasters(view);
      } catch (err) { toast(err.message, true); }
    });
  });
}

/* ---------- ルーティング ---------- */
const TABS = { stock: renderStock, transfers: renderTransfers, invoices: renderInvoices, masters: renderMasters };
let navToken = 0;

async function route() {
  const token = ++navToken;
  const view = $('#view');
  view.innerHTML = '<p class="muted">読み込み中…</p>';
  try {
    if (!currentUser && !(await checkSession())) {
      if (token === navToken) await renderAuth(view);
      return;
    }
    renderUserBar();
    const name = location.hash.replace('#', '') || 'stock';
    const render = TABS[name] || renderStock;
    if (name !== 'invoices') { invUI.mode = 'list'; invUI.draft = null; }
    document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
    await loadMasters();
    if (token !== navToken) return;
    await render(view);
  } catch (err) {
    if (token !== navToken) return;
    if (err.status === 401) {
      // ログインの期限切れ
      writeToken(null);
      currentUser = null;
      return route();
    }
    view.innerHTML = `<section class="card"><p class="neg">エラー: ${esc(err.message)}</p></section>`;
  }
}

$('#invoice-print-btn').addEventListener('click', () => window.print());
const resetBtn = $('#local-reset');
if (resetBtn) {
  resetBtn.addEventListener('click', async () => {
    if (!confirm('ブラウザ内のデータをすべて消して作り直します。よろしいですか?')) return;
    try {
      await window.inventoryLocalReset();
      writeToken(null);
      currentUser = null;
      toast('データを初期化しました');
      route();
    } catch (err) { toast(err.message, true); }
  });
}
$('#invoice-close-btn').addEventListener('click', () => $('#invoice-dialog').close());
window.addEventListener('hashchange', route);
route();
