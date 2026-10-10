/* All screens. Each screen function returns
 *   { title, back?, node, live, fab? }
 * live = true means the screen redraws itself when new data arrives
 * (forms are not live, so typing is never interrupted). */
import { h, iconEl, icon, toast, confirmDialog, promptDialog, fmtDate, fmtMoney, fmtNumber, relTime, stageShort } from './ui.js';
import { sendChat, chatView, refreshChat, markChatSeen, onChange } from './sync.js';
import { model, enqueue, syncNow, pendingCount, attentionCount, discardChange, retryChange, keepMine, keepTheirs, signOut, isTemp } from './sync.js';
import { renderForm, fieldList, findRecord, ruleFor, refHref, humanTable, valueNode } from './fields.js';
import { CONFIG } from './config.js';

const B = window.BGS;
const S = B.S;
const sameKey = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
let navList = { keys: [], from: '#/active' };
const ui = { active: { q: '', sel: null, open: {} }, all: { q: '', sel: null, open: {} }, actions: { tab: 'mine', q: '' } };

/* ================= shared pieces ================= */

function searchBox(state, placeholder, onInput) {
  const input = h('input', { type: 'search', placeholder, value: state.q, 'aria-label': placeholder, oninput: e => { state.q = e.target.value; onInput(); } });
  return h('label', { class: 'search' }, h('span', { html: icon.search, style: 'display:inline-flex' }), input);
}
function matches(rec, cols, q) {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  return cols.some(c => String(rec[c] ?? '').toLowerCase().includes(needle));
}
function rail(stage, small) {
  const idx = B.stageIndex(stage);
  const rejected = B.same(stage, S.S7);
  const done = B.same(stage, S.S6);
  const cls = 'rail' + (rejected ? ' rejected' : '') + (done ? ' complete' : '');
  const segs = [];
  for (let i = 1; i <= 6; i++) {
    let c = '';
    if (rejected) c = i === 6 ? 'now' : '';
    else if (i < idx) c = 'done';
    else if (i === idx) c = 'now';
    segs.push(h('i', { class: c }));
  }
  return h('div', { class: cls, 'aria-hidden': small ? 'true' : null }, segs);
}
function statusBadge(status) {
  const s = String(status || '');
  const cls = /late/i.test(s) ? 'late' : /complet|closed/i.test(s) ? 'completed' : /progress/i.test(s) ? 'progress' : /pending/i.test(s) ? 'pending' : '';
  return h('span', { class: 'badge ' + cls }, s || '—');
}
function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('strong', null, title), text ? h('div', null, text) : null, action ? h('div', { style: 'margin-top:16px' }, action) : null);
}
function sectionHead(title, count, button) {
  return h('div', { class: 'section-head' }, title, count !== undefined ? h('span', { class: 'count' }, String(count)) : null, button || null);
}
function projectData(pnum) {
  return {
    items: model.view.Items.filter(i => sameKey(i.Project_ID, pnum)),
    satisfactions: model.view.Customer_Satisfaction.filter(s => sameKey(s.Project_ID, pnum))
  };
}

/* ================= project lists ================= */

const PROJECT_SEARCH = ['P#', 'Project Name', 'BD Project Name', 'Company', 'Customer', 'Criticality', 'Quotation_No', 'PO_No', 'Invoice#', 'Rejection Reason', 'Contract#'];

export function projectsScreen(mode) {
  const st = ui[mode];
  const node = h('div');
  const isActive = mode === 'active';
  // The search box is built once and never redrawn, so the phone keyboard stays open while typing.
  const selBtn = h('button', { class: 'btn small', onclick: () => { st.sel = st.sel ? null : new Set(); draw(); } });
  const body = h('div');
  node.append(h('div', { class: 'toolbar' }, searchBox(st, 'Search projects', () => draw()), selBtn), body);
  function draw() {
    selBtn.textContent = st.sel ? 'Done' : 'Select';
    selBtn.setAttribute('aria-pressed', st.sel ? 'true' : 'false');
    body.innerHTML = '';
    let list = model.view.Projects.filter(p => isActive ? !B.inList(p.Stage, [S.S6, S.S7]) : true);
    list = list.filter(p => matches(p, PROJECT_SEARCH, st.q)).sort((a, b) => (Number(a['P#']) || 1e9) - (Number(b['P#']) || 1e9));
    const groups = isActive ? [S.S1, S.S2, S.S3, S.S4, S.S5] : B.STAGES;
    // remember the order shown, so the project screen can swipe to the next / previous one
    navList = { keys: [], from: isActive ? '#/active' : '#/projects' };
    groups.forEach(stage => list.filter(p => B.same(p.Stage, stage)).forEach(p => navList.keys.push(String(p['P#']))));
    if (!isActive) list.filter(p => !B.inList(p.Stage, groups)).forEach(p => navList.keys.push(String(p['P#'])));
    if (!list.length) {
      body.append(model.lastSync || model.view.Projects.length
        ? emptyState(st.q ? 'No matching projects' : 'No active projects', st.q ? 'Try a different word, or clear the search.' : 'Add a project to start the pipeline.')
        : emptyState('Loading projects', 'The first download can take a few seconds.'));
      return;
    }
    groups.forEach(stage => {
      const rows = list.filter(p => B.same(p.Stage, stage));
      if (!rows.length) return;
      const big = rows.length > 40 && !st.q;
      const open = st.open[stage] || !big;
      const g = h('section', { class: 'group' },
        h('div', { class: 'group-head' }, stageShort(stage), h('span', { class: 'count' }, String(rows.length)),
          big ? h('button', { class: 'btn link', onclick: () => { st.open[stage] = !open; draw(); } }, open ? 'Hide' : 'Show all') : null));
      if (open) g.append(h('div', { class: 'list' }, rows.map(p => projectRow(p, st, draw))));
      body.append(g);
    });
    // anything with an unknown stage still shows, at the end
    const odd = list.filter(p => !B.inList(p.Stage, groups));
    if (odd.length && !isActive) body.append(h('section', { class: 'group' }, h('div', { class: 'group-head' }, 'Other', h('span', { class: 'count' }, String(odd.length))), h('div', { class: 'list' }, odd.map(p => projectRow(p, st, draw)))));
    if (st.sel) body.append(bulkBar(st, draw));
  }
  draw();
  return {
    title: isActive ? 'Active Projects' : 'Projects', node, live: true, redraw: draw,
    fab: st.sel ? null : { label: 'New project', href: '#/new/Projects' }
  };
}

function projectRow(p, st, redraw) {
  const key = p['P#'];
  const sub = [p.Company, p.Customer].filter(x => !B.isBlank(x)).join(', ');
  const inner = [
    st.sel ? h('input', { type: 'checkbox', class: 'check', checked: st.sel.has(String(key)), 'aria-label': 'Select project ' + key, onclick: e => e.stopPropagation(), onchange: e => { e.target.checked ? st.sel.add(String(key)) : st.sel.delete(String(key)); redraw(); } }) : null,
    h('span', { class: 'pnum' }, isTemp(key) ? 'new' : String(key)),
    h('div', { class: 'main' },
      h('div', { class: 'title' }, p['BD Project Name'] || p['Project Name'] || 'Project ' + key, p.__pending ? h('span', { class: 'sr-only' }, ' (not yet synced)') : null),
      sub ? h('div', { class: 'sub' }, sub) : null,
      rail(p.Stage, true)),
    !B.isBlank(p.Criticality) ? h('div', { class: 'meta', title: 'Criticality' }, p.Criticality) : null,
    p.__pending ? h('span', { class: 'badge pending', title: 'Waiting to sync' }, 'Pending') : null
  ];
  if (st.sel) return h('label', { class: 'row' }, inner);
  return h('a', { class: 'row', href: '#/p/' + encodeURIComponent(key) }, inner);
}

function bulkBar(st, redraw) {
  const chosen = model.view.Projects.filter(p => st.sel.has(String(p['P#'])));
  const ready = chosen.map(p => ({ p, nm: B.nextMove(p, model.user, projectData(p['P#'])) })).filter(x => x.nm && x.nm.ok);
  const rejectable = chosen.filter(p => B.canReject(p) && !isTemp(p['P#']));
  return h('div', { class: 'bulkbar' },
    h('span', { class: 'count' }, chosen.length + ' selected'),
    h('button', { class: 'btn small primary', disabled: !ready.length, onclick: async () => {
      for (const x of ready) await enqueue({ op: 'move', table: 'Projects', key: x.p['P#'], to: x.nm.move.to }, x.nm.move.name + ': ' + (x.p['BD Project Name'] || x.p['P#']));
      toast(ready.length + ' project(s) moved to their next stage.');
      st.sel = new Set(); redraw();
    } }, 'Move to next stage (' + ready.length + ')'),
    h('button', { class: 'btn small danger', disabled: !rejectable.length, onclick: async () => {
      if (!await confirmDialog({ title: 'Reject ' + rejectable.length + ' project(s)?', message: 'Are you sure you want to reject project?', confirmText: 'Continue', danger: true })) return;
      const reason = await promptDialog({ title: 'Rejection reason', label: 'Rejection Reason', confirmText: 'Reject', danger: true });
      if (!reason) return;
      for (const p of rejectable) await enqueue({ op: 'reject', table: 'Projects', key: p['P#'], reason }, 'Reject project ' + (p['BD Project Name'] || p['P#']));
      st.sel = new Set(); redraw();
    } }, 'Reject (' + rejectable.length + ')'));
}

/* ================= project detail ================= */

const PROJECT_DETAIL = ['Project Name', 'Company', 'Customer', 'Contract#', 'Quotation_No', 'Quotation', 'PO_No', 'PO', 'Invoice#', 'Invoice', 'Expected Cash In', 'Rejection Reason', 'Documentation_Verified', 'Satisfaction_Completed'];

/* Swipe left / right on a project to open the next / previous one (Omar, 9 Oct 2026).
 * The order is the list the project was opened from (Active or Projects, with any
 * search applied). Opened from elsewhere: the Active order (or all projects for a
 * Done/Rejected one). */
function neighbours(key) {
  let keys = navList.keys;
  if (!keys.includes(String(key))) {
    const p = findRecord('Projects', key);
    const active = p && !B.inList(p.Stage, [S.S6, S.S7]);
    keys = model.view.Projects.filter(x => active ? !B.inList(x.Stage, [S.S6, S.S7]) : true)
      .sort((a, b) => (B.stageIndex(a.Stage) || 99) - (B.stageIndex(b.Stage) || 99) || (Number(a['P#']) || 1e9) - (Number(b['P#']) || 1e9))
      .map(x => String(x['P#']));
  }
  const i = keys.indexOf(String(key));
  return { i, n: keys.length, prev: i > 0 ? keys[i - 1] : null, next: i >= 0 && i < keys.length - 1 ? keys[i + 1] : null };
}
let slideFrom = null;
function goProject(target, dir) {
  slideFrom = dir;
  location.replace('#/p/' + encodeURIComponent(target));
}

export function projectScreen(key) {
  const node = h('div', { class: 'swipe-area' });
  if (slideFrom) { node.classList.add(slideFrom === 'next' ? 'slide-from-right' : 'slide-from-left'); slideFrom = null; }
  // swipe gesture (ignored when it starts in a text field or drop-down)
  let sx = null, sy = 0, t0 = 0;
  node.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || e.target.closest('input, textarea, select')) { sx = null; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  node.addEventListener('touchend', e => {
    if (sx === null) return;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; sx = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy) || Date.now() - t0 > 700) return;
    const nb = neighbours(key), dir = dx < 0 ? 'next' : 'prev';
    if (nb[dir]) goProject(nb[dir], dir);
    else toast(dir === 'next' ? 'This is the last project in the list.' : 'This is the first project in the list.');
  }, { passive: true });
  function draw() {
    node.innerHTML = '';
    const p = findRecord('Projects', key);
    if (!p) { node.append(emptyState('Project not found', 'It may be hidden from you, or it was removed. Open More, then Sync, and tap Sync now.')); return; }
    const pnum = p['P#'];
    const nb = neighbours(key);
    if (nb.i >= 0 && nb.n > 1) {
      node.append(h('div', { class: 'pager', role: 'navigation', 'aria-label': 'Other projects in this list' },
        h('button', { class: 'icon-btn', 'aria-label': 'Previous project', disabled: !nb.prev, html: icon.back, onclick: () => nb.prev && goProject(nb.prev, 'prev') }),
        h('span', null, (nb.i + 1) + ' of ' + nb.n),
        h('button', { class: 'icon-btn flip', 'aria-label': 'Next project', disabled: !nb.next, html: icon.back, onclick: () => nb.next && goProject(nb.next, 'next') })));
    }
    const data = projectData(pnum);
    const nm = B.nextMove(p, model.user, data);
    const tempNote = isTemp(pnum) ? h('div', { class: 'banner info' }, 'This project was created on this phone. It gets its P# when it syncs.') : null;

    node.append(h('div', { class: 'hero' },
      h('div', { class: 'num' }, isTemp(pnum) ? 'New' : 'P' + pnum),
      h('h2', null, p['BD Project Name'] || p['Project Name']),
      h('div', { class: 'who' },
        !B.isBlank(p.Company) ? h('a', { href: refHref('Lists', p.Company) }, p.Company) : null,
        !B.isBlank(p.Company) && !B.isBlank(p.Customer) ? ', ' : null,
        !B.isBlank(p.Customer) ? h('a', { href: refHref('Customers', p.Customer) }, p.Customer) : null,
        !B.isBlank(p.Criticality) ? h('span', { class: 'badge', style: 'margin-left:8px' }, p.Criticality) : null)),
      ...[tempNote, stageTrack(p)].filter(Boolean));

    const bar = h('div', { class: 'actions-bar' });
    let needs = null;
    if (nm) {
      // The next-stage button is always shown; it stays greyed out until every requirement is met.
      bar.append(h('button', { class: 'btn primary next-move', disabled: !nm.ok, 'aria-describedby': nm.ok ? null : 'move-needs', onclick: async () => {
        if (!nm.ok) return;
        await enqueue({ op: 'move', table: 'Projects', key: pnum, to: nm.move.to }, nm.move.name + ': ' + (p['BD Project Name'] || pnum));
        toast('Moved to ' + stageShort(nm.move.to) + '.');
      } }, h('span', null, nm.move.name), iconEl('arrow')));
      if (!nm.ok) {
        const lines = [];
        if (!nm.userAllowed) lines.push('Only ' + B.deptNames(nm.move.depts) + ' can do this step.');
        nm.reasons.forEach(r => lines.push(r));
        needs = h('div', { class: 'needs', id: 'move-needs', role: 'note' },
          h('div', { class: 'needs-title' }, 'Still needed before "' + nm.move.name + '"'),
          h('ul', null, lines.map(t => h('li', null, t))));
      }
    }
    const prev = isTemp(pnum) ? null : B.previousStage(p);
    if (prev) {
      bar.append(h('button', { class: 'btn step-back', onclick: async () => {
        if (!await confirmDialog({ title: 'Move back to ' + stageShort(prev) + '?', message: 'The project goes back from ' + stageShort(p.Stage) + ' to ' + stageShort(prev) + '. This is recorded in the stage history.', confirmText: 'Move back' })) return;
        await enqueue({ op: 'back', table: 'Projects', key: pnum, from: p.Stage, to: prev }, 'Move project ' + (p['BD Project Name'] || pnum) + ' back to ' + stageShort(prev));
        toast('Moved back to ' + stageShort(prev) + '.');
      } }, iconEl('back'), 'Back to ' + stageShort(prev)));
    }
    bar.append(h('a', { class: 'btn', href: '#/edit/Projects/' + encodeURIComponent(pnum) }, iconEl('edit'), 'Edit'));
    if (B.canReject(p)) {
      bar.append(h('button', { class: 'btn danger', onclick: async () => {
        if (!await confirmDialog({ title: 'Reject this project?', message: 'Are you sure you want to reject project?', confirmText: 'Continue', danger: true })) return;
        const reason = await promptDialog({ title: 'Rejection reason', message: 'A reason is required for rejected projects.', label: 'Rejection Reason', confirmText: 'Reject project', danger: true });
        if (!reason) return;
        await enqueue({ op: 'reject', table: 'Projects', key: pnum, reason }, 'Reject project ' + (p['BD Project Name'] || pnum));
        toast('Project rejected.');
      } }, 'Reject'));
    }
    node.append(bar);
    if (needs) node.append(needs);

    node.append(h('div', { class: 'section' }, fieldList('Projects', p, PROJECT_DETAIL)));

    // Items (SOURCE: Related Items, "➕ Add Items")
    node.append(h('div', { class: 'section' },
      sectionHead('Items', data.items.length, B.canAdd('Items', model.user) ? h('a', { class: 'btn small', href: '#/new/Items?Project_ID=' + encodeURIComponent(pnum) }, iconEl('plus'), 'Add items') : null),
      data.items.length ? h('div', { class: 'list' }, data.items.sort((a, b) => String(a.Item_ID).localeCompare(String(b.Item_ID))).map(it => itemRow(it, p))) : h('div', { class: 'list' }, h('div', { class: 'note' }, 'No items yet. A project needs at least one item to move to Pricing.'))));

    // Customer satisfaction (SOURCE: Related Customer_Satisfactions Show_If)
    if (ruleFor('Projects', 'Satisfaction_Completed', p).visible) {
      node.append(h('div', { class: 'section' },
        sectionHead('Customer satisfaction', data.satisfactions.length, h('a', { class: 'btn small', href: '#/new/Customer_Satisfaction?Project_ID=' + encodeURIComponent(pnum) }, iconEl('plus'), 'Add')),
        data.satisfactions.length ? h('div', { class: 'list' }, data.satisfactions.map(s => h('a', { class: 'row', href: refHref('Customer_Satisfaction', s.Satisfaction_ID) },
          h('div', { class: 'main' }, h('div', { class: 'title' }, 'Overall ' + (s.Overall_Rating || '—') + ', delivery ' + (s.Delivery_Rating || '—') + ', quality ' + (s.Quality_Rating || '—')), h('div', { class: 'sub' }, (s.Comments || '') + ' ' + fmtDate(s.Submitted_At)))))) : h('div', { class: 'list' }, h('div', { class: 'note' }, 'No feedback yet. One record is needed before moving to Done.'))));
    }

    // Actions (SOURCE: Related Action Trackers, "➕ Add Actions")
    const acts = model.view['Action Tracker'].filter(a => sameKey(a['Project #'], pnum));
    node.append(h('div', { class: 'section' },
      sectionHead('Actions', acts.length, h('a', { class: 'btn small', href: '#/new/Action%20Tracker?' + new URLSearchParams({ 'Project #': pnum }) }, iconEl('plus'), 'Add actions')),
      acts.length ? h('div', { class: 'list' }, acts.map(a => actionRow(a))) : null));

    // Stage history (hidden column in AppSheet; shown here folded, read-only)
    const hist = model.view.Stage_History.filter(x => sameKey(x.Project_ID, pnum)).sort((a, b) => String(b.Changed_At).localeCompare(String(a.Changed_At)));
    if (hist.length) {
      node.append(h('details', { class: 'more' }, h('summary', null, 'Stage history (' + hist.length + ')'),
        h('div', { class: 'list' }, hist.map(x => h('a', { class: 'row', href: refHref('Stage_History', x.History_ID) },
          h('div', { class: 'main' }, h('div', { class: 'title' }, stageShort(x.From_Stage) + ' to ' + stageShort(x.To_Stage)), h('div', { class: 'sub' }, (x.Changed_By || '') + ', ' + fmtDate(x.Changed_At))))))));
    }
  }
  draw();
  return { title: 'Project', back: navList.keys.includes(String(key)) ? navList.from : '#/active', node, live: true, redraw: draw };
}

function stageTrack(p) {
  const idx = B.stageIndex(p.Stage);
  const rejected = B.same(p.Stage, S.S7);
  const label = rejected ? h('span', { class: 'rej' }, 'Rejected')
    : idx >= 1 && idx <= 6 ? [h('span', { class: 'now' }, stageShort(p.Stage)), h('span', { class: 'of' }, 'Stage ' + idx + ' of 6')]
    : h('span', { class: 'now' }, String(p.Stage || 'No stage'));
  return h('div', { class: 'stage-track', role: 'img', 'aria-label': 'Stage: ' + p.Stage }, rail(p.Stage), h('div', { class: 'stage-label' }, label));
}

/* ================= items ================= */

function itemRow(it, project) {
  const fromExec = project && B.inList(project.Stage, [S.S4, S.S5, S.S6, S.S7]);
  const sub = [it.Item_Type, !B.isBlank(it.Qty) ? 'Qty ' + fmtNumber(it.Qty) : '', it.Specification].filter(x => !B.isBlank(x)).join(', ');
  return h('a', { class: 'row', href: '#/i/' + encodeURIComponent(it.Item_ID) },
    h('div', { class: 'main' },
      h('div', { class: 'title' }, it.Item_Name || 'Item'),
      h('div', { class: 'sub' }, (isTemp(it.Item_ID) ? 'New' : it.Item_ID) + (sub ? ', ' + sub : ''))),
    h('div', { class: 'meta' },
      ruleFor('Items', 'Selling_Price', it).visible && !B.isBlank(it.Selling_Price) ? h('div', null, fmtMoney(it.Selling_Price)) : null,
      fromExec ? (B.isTrue(it.Delivered) ? h('span', { class: 'badge done' }, 'Delivered') : h('span', { class: 'badge' }, 'Not delivered')) : null,
      it.__pending ? h('span', { class: 'badge pending' }, 'Pending') : null));
}

const ITEM_DETAIL = ['Execution_Photos', 'Item_Name', 'Project_ID', 'BD Project Name', 'Item_ID', 'Item_Type', 'Specification', 'Qty', 'Lead_Time_Days', 'Estimated_Cost', 'Selling_Price', 'Delivered', 'Delivery_Date'];

export function itemScreen(key) {
  const node = h('div');
  let back = '#/active';
  function draw() {
    node.innerHTML = '';
    const it = findRecord('Items', key);
    if (!it) { node.append(emptyState('Item not found', 'It may have been deleted.')); return; }
    back = '#/p/' + encodeURIComponent(it.Project_ID);
    node.append(h('div', { class: 'hero' }, h('div', { class: 'num' }, isTemp(it.Item_ID) ? 'New item' : it.Item_ID), h('h2', null, it.Item_Name || 'Item'),
      h('div', { class: 'who' }, h('a', { href: '#/p/' + encodeURIComponent(it.Project_ID) }, it['BD Project Name'] || ('Project ' + it.Project_ID)))));
    node.append(h('div', { class: 'actions-bar' },
      h('a', { class: 'btn', href: '#/edit/Items/' + encodeURIComponent(it.Item_ID) }, iconEl('edit'), 'Edit'),
      B.canDelete('Items', model.user) ? deleteButton('Items', it.Item_ID, back) : null));
    node.append(h('div', { class: 'section' }, fieldList('Items', it, ITEM_DETAIL)));
    // Quality checks for this item (Item_ID is plain text in the sheet, matched exactly)
    const qcs = model.view.Quality_Checks.filter(q => sameKey(q.Item_ID, it.Item_ID));
    node.append(h('div', { class: 'section' },
      sectionHead('Quality checks', qcs.length, isTemp(it.Item_ID) ? null : h('a', { class: 'btn small', href: '#/new/Quality_Checks?Item_ID=' + encodeURIComponent(it.Item_ID) }, iconEl('plus'), 'Add')),
      qcs.length ? h('div', { class: 'list' }, qcs.map(q => h('a', { class: 'row', href: refHref('Quality_Checks', q.Check_ID) }, h('div', { class: 'main' }, h('div', { class: 'title' }, q.Check || 'Check'), h('div', { class: 'sub' }, [q.Result, q.Checked_By, q.Checked_At].filter(Boolean).join(', ')))))) : null));
  }
  draw();
  return { title: 'Item', get back() { return back; }, node, live: true, redraw: draw };
}

/* ================= actions ================= */

const ACTION_SEARCH = ['Action', 'BD Project Name', 'Owner', 'Location', 'Status', 'Criticality'];

function actionRow(a, showOwner) {
  const open = B.isOpenAction(a);
  const dueLate = /late/i.test(a.Status);
  return h('div', { class: 'row', onclick: () => { location.hash = '#/a/' + encodeURIComponent(a['Action #']); } },
    open ? h('button', { class: 'icon-btn', title: 'Mark as complete', 'aria-label': 'Mark "' + a.Action + '" as complete', style: 'border:2px solid var(--line);width:36px;height:36px',
      onclick: async (e) => { e.stopPropagation(); await enqueue({ op: 'complete', table: 'Action Tracker', key: a['Action #'] }, 'Complete: ' + a.Action); toast('Marked as complete.'); } }) :
      h('span', { class: 'icon-btn', style: 'color:var(--green)', html: icon.check, 'aria-label': 'Completed' }),
    h('div', { class: 'main' },
      h('div', { class: 'title' }, a.Action || 'Action'),
      h('div', { class: 'sub' }, [a['BD Project Name'], showOwner ? a.Owner : null, a.Location].filter(x => !B.isBlank(x)).join(', '))),
    h('div', { class: 'meta' }, h('div', { style: dueLate ? 'color:var(--red);font-weight:600' : '' }, fmtDate(a['Due Date'])), statusBadge(a.Status)));
}

export function actionsScreen() {
  const st = ui.actions;
  const node = h('div');
  const tabBtn = (tab, label) => h('button', { 'aria-pressed': 'false', onclick: () => { st.tab = tab; draw(); } }, label);
  const mineBtn = tabBtn('mine', 'My Actions'), allBtn = tabBtn('all', 'All Actions');
  const body = h('div');
  // search box built once (keeps the phone keyboard open while typing)
  node.append(h('div', { class: 'segmented', role: 'group' }, mineBtn, allBtn), h('div', { class: 'toolbar' }, searchBox(st, 'Search actions', () => draw())), body);
  function draw() {
    mineBtn.setAttribute('aria-pressed', st.tab === 'mine' ? 'true' : 'false');
    allBtn.setAttribute('aria-pressed', st.tab === 'all' ? 'true' : 'false');
    body.innerHTML = '';
    const me = model.user ? model.user.name : '';
    // SOURCE: slices "My Actions" and "All Actions" (open = not Completed and not Closed)
    let rows = model.view['Action Tracker'].filter(a => B.isOpenAction(a) && matches(a, ACTION_SEARCH, st.q));
    if (st.tab === 'mine') {
      body.append(hoursByLocation(st, me, draw));
      rows = rows.filter(a => B.same(a.Owner, me)).sort((a, b) => String(a['Due Date']).localeCompare(String(b['Due Date'])));
      body.append(rows.length ? h('div', { class: 'list', style: 'margin-top:12px' }, rows.map(a => actionRow(a, false))) : emptyState('Nothing on your list', st.q ? 'No open actions match the search.' : 'Open actions assigned to you appear here.'));
    } else {
      const owners = [...new Set(rows.map(a => a.Owner || ''))].sort((a, b) => a.localeCompare(b));
      if (!rows.length) body.append(emptyState('No open actions', st.q ? 'No actions match the search.' : ''));
      owners.forEach(o => {
        const mine = rows.filter(a => (a.Owner || '') === o);
        body.append(h('section', { class: 'group' }, h('div', { class: 'group-head' }, o || 'No owner', h('span', { class: 'count' }, String(mine.length))), h('div', { class: 'list' }, mine.map(a => actionRow(a, false)))));
      });
    }
  }
  draw();
  return { title: 'Actions', node, live: true, redraw: draw, fab: { label: 'Add action', href: '#/new/Action%20Tracker' } };
}

/* Open hours by location (Omar, 9 Oct 2026): the estimated hours of a person's
 * open actions, added up per location. Everyone sees their own; Management can
 * pick any person. Actions without an estimate are counted but add no hours. */
function hoursByLocation(st, me, redraw) {
  const isMgmt = model.perms && model.perms.manageUsers;
  const who = isMgmt && st.hoursFor ? st.hoursFor : me;
  const open = model.view['Action Tracker'].filter(a => B.isOpenAction(a) && B.same(a.Owner, who));
  const byLoc = new Map();
  let total = 0, noEstimate = 0;
  open.forEach(a => {
    const loc = B.isBlank(a.Location) ? 'No location' : String(a.Location).trim();
    const n = Number(a['Estimated Time']);
    const hrs = B.isBlank(a['Estimated Time']) || isNaN(n) ? 0 : n;
    if (B.isBlank(a['Estimated Time']) || isNaN(n)) noEstimate++;
    const g = byLoc.get(loc) || { hrs: 0, count: 0, late: 0 };
    g.hrs += hrs; g.count++; if (/late/i.test(a.Status)) g.late++;
    byLoc.set(loc, g); total += hrs;
  });
  const fmtH = x => (Math.round(x * 10) / 10).toLocaleString('en-GB') + ' h';
  const picker = isMgmt ? h('select', { class: 'hours-who', 'aria-label': 'Show hours for', onchange: e => { st.hoursFor = e.target.value; redraw(); } },
    model.view.Users.filter(u => u.Active !== false && !B.same(u.Active, 'Inactive') && !B.isBlank(u.Name)).map(u => u.Name).sort()
      .map(n => h('option', { value: n, selected: B.same(n, who) }, B.same(n, me) ? n + ' (me)' : n))) : null;
  const rows = [...byLoc.entries()].sort((a, b) => b[1].hrs - a[1].hrs || a[0].localeCompare(b[0]));
  return h('section', { class: 'hours', 'aria-label': 'Open hours by location' },
    h('div', { class: 'hours-head' }, h('span', null, 'Open hours by location'), picker),
    rows.length ? h('table', null,
      h('tbody', null, rows.map(([loc, g]) => {
        const href = locationHref(loc === 'No location' ? NO_LOC : loc, who, me);
        return h('tr', { class: 'hours-link', onclick: () => { location.hash = href; } },
          h('th', { scope: 'row' }, h('a', { href }, loc), h('span', { class: 'hours-sub' }, g.count + ' action' + (g.count === 1 ? '' : 's') + (g.late ? ', ' + g.late + ' late' : ''))),
          h('td', null, fmtH(g.hrs), h('span', { class: 'chev', html: icon.back })));
      })),
      h('tfoot', null, h('tr', { class: 'hours-link', onclick: () => { location.hash = locationHref(ALL_LOC, who, me); } },
        h('th', { scope: 'row' }, h('a', { href: locationHref(ALL_LOC, who, me) }, 'Total'), h('span', { class: 'hours-sub' }, open.length + ' open action' + (open.length === 1 ? '' : 's'))),
        h('td', null, fmtH(total), h('span', { class: 'chev', html: icon.back }))))) :
      h('div', { class: 'hours-empty' }, B.same(who, me) ? 'You have no open actions.' : who + ' has no open actions.'),
    noEstimate ? h('div', { class: 'hours-note' }, noEstimate + ' open action' + (noEstimate === 1 ? ' has' : 's have') + ' no estimated time.') : null);
}

/* Tapping a location in "Open hours by location" opens that person's open actions
 * there (Omar, 9 Oct 2026). NO_LOC = actions without a location; ALL_LOC = every location. */
const NO_LOC = '-', ALL_LOC = '*';
function locationHref(loc, who, me) {
  return '#/actions/at/' + encodeURIComponent(loc) + (B.same(who, me) ? '' : '?who=' + encodeURIComponent(who));
}
function sameLocation(a, loc) {
  if (loc === ALL_LOC) return true;
  if (loc === NO_LOC) return B.isBlank(a.Location);
  return B.same(a.Location, loc);
}

export function actionsAtScreen(loc, whoParam) {
  const node = h('div');
  const me = model.user ? model.user.name : '';
  const isMgmt = model.perms && model.perms.manageUsers;
  const who = isMgmt && whoParam ? whoParam : me;   // only Management may look at someone else's
  const place = loc === ALL_LOC ? 'All locations' : loc === NO_LOC ? 'No location' : loc;
  function draw() {
    node.innerHTML = '';
    const rows = model.view['Action Tracker'].filter(a => B.isOpenAction(a) && B.same(a.Owner, who) && sameLocation(a, loc))
      .sort((a, b) => String(a['Due Date']).localeCompare(String(b['Due Date'])));
    let hrs = 0, noEst = 0;
    rows.forEach(a => { const n = Number(a['Estimated Time']); if (B.isBlank(a['Estimated Time']) || isNaN(n)) noEst++; else hrs += n; });
    const late = rows.filter(a => /late/i.test(a.Status)).length;
    node.append(h('div', { class: 'hero' },
      h('h2', { style: 'margin-top:0' }, place),
      h('div', { class: 'who' }, (B.same(who, me) ? 'My' : who + "'s") + ' open actions'),
      h('div', { class: 'loc-stats' },
        h('div', null, h('strong', null, (Math.round(hrs * 10) / 10).toLocaleString('en-GB') + ' h'), h('span', null, 'estimated')),
        h('div', null, h('strong', null, String(rows.length)), h('span', null, 'open')),
        h('div', { class: late ? 'is-late' : '' }, h('strong', null, String(late)), h('span', null, 'late'))),
      noEst ? h('div', { class: 'hours-note' }, noEst + ' of these ' + (noEst === 1 ? 'has' : 'have') + ' no estimated time.') : null));
    node.append(rows.length ? h('div', { class: 'list', style: 'margin-top:12px' }, rows.map(a => actionRow(a, false)))
      : emptyState('No open actions here', 'Completed actions are not listed.'));
  }
  draw();
  return { title: place + ' actions', back: '#/actions', node, live: true, redraw: draw, fab: { label: 'Add action', href: '#/new/Action%20Tracker' } };
}

const ACTION_DETAIL = ['Action', 'BD Project Name', 'Criticality', 'Owner', 'Due Date', 'Location', 'Estimated Time', 'Status', 'Created at'];

export function actionScreen(key) {
  const node = h('div');
  function draw() {
    node.innerHTML = '';
    const a = findRecord('Action Tracker', key);
    if (!a) { node.append(emptyState('Action not found', 'It may have been deleted.')); return; }
    node.append(h('div', { class: 'hero' }, h('h2', { style: 'margin-top:0' }, a.Action || 'Action'), h('div', { class: 'who' }, statusBadge(a.Status))));
    const bar = h('div', { class: 'actions-bar' });
    if (B.isOpenAction(a)) bar.append(h('button', { class: 'btn primary', onclick: async () => { await enqueue({ op: 'complete', table: 'Action Tracker', key: a['Action #'] }, 'Complete: ' + a.Action); toast('Marked as complete.'); } }, iconEl('check'), 'Mark as complete'));
    bar.append(h('a', { class: 'btn', href: '#/edit/Action%20Tracker/' + encodeURIComponent(a['Action #']) }, iconEl('edit'), 'Edit'));
    if (!B.isBlank(a['Project #']) && Number(a['Project #']) !== 0 && findRecord('Projects', a['Project #'])) bar.append(h('a', { class: 'btn', href: '#/p/' + encodeURIComponent(a['Project #']) }, 'Open project'));
    bar.append(deleteButton('Action Tracker', a['Action #'], '#/actions'));
    node.append(bar, h('div', { class: 'section' }, fieldList('Action Tracker', a, ACTION_DETAIL)));
  }
  draw();
  return { title: 'Action', back: '#/actions', node, live: true, redraw: draw };
}

/* ================= customer satisfaction menu ================= */

export function satisfactionScreen() {
  const node = h('div');
  const intro = h('div', { class: 'hero' }, h('h2', { style: 'margin-top:0' }, 'Customer feedback'), h('div', { class: 'who' }, 'Record how the customer rated a project. Rating fields take any text; tap a number for a quick score.'));
  function fresh() {
    const f = renderForm({ table: 'Customer_Satisfaction', record: {}, isNew: true, onDone: () => { node.innerHTML = ''; node.append(intro, h('div', { class: 'banner info' }, 'Feedback saved. You can record another one below.'), fresh()); window.scrollTo(0, 0); } });
    return h('div', null, f.el, h('div', { class: 'form-actions' }, h('button', { class: 'btn primary', onclick: () => f.save() }, 'Save feedback')));
  }
  node.append(intro, fresh());
  return { title: 'Customer Satisfaction', node, live: false };
}

/* ================= add / edit forms ================= */

export function formScreen(table, key, params) {
  const def = B.SCHEMA[table];
  if (!def) return { title: 'Not found', node: emptyState('Unknown screen', '') };
  const isNew = key === null;
  if (isNew && !B.canAdd(table, model.user)) return { title: 'Not allowed', node: emptyState('Not allowed', 'Only Management can add records here.') };
  const rec = isNew ? {} : findRecord(table, key);
  if (!isNew && !rec) return { title: 'Not found', node: emptyState('Record not found', 'It may have been deleted.') };
  const context = {};
  if (isNew && params) params.forEach((v, k) => { if (B.column(table, k)) context[k] = /^\d+$/.test(v) ? Number(v) : v; });
  const backTo = isNew
    ? (context.Project_ID && table !== 'Customer_Satisfaction' ? '#/p/' + encodeURIComponent(context.Project_ID) : context['Project #'] ? '#/p/' + encodeURIComponent(context['Project #']) : context.Project_ID ? '#/p/' + encodeURIComponent(context.Project_ID) : context.Item_ID ? '#/i/' + encodeURIComponent(context.Item_ID) : defaultBack(table))
    : refHref(table, key);
  const f = renderForm({
    table, record: rec, isNew, context,
    onDone: (newKey) => {
      if (isNew && table === 'Projects') location.replace('#/p/' + encodeURIComponent(newKey));
      else if (isNew && (table === 'Items' || table === 'Action Tracker' || table === 'Customer_Satisfaction' || table === 'Quality_Checks')) location.replace(backTo);
      else location.replace(refHref(table, newKey));
    }
  });
  const node = h('div', null, f.el, h('div', { class: 'form-actions' },
    h('a', { class: 'btn', href: backTo }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: () => f.save() }, f.submitText)));
  return { title: (isNew ? 'New ' : 'Edit ') + humanTable(table), back: backTo, node, live: false };
}
function defaultBack(table) {
  if (table === 'Projects') return '#/active';
  if (table === 'Action Tracker') return '#/actions';
  if (table === 'Customer_Satisfaction') return '#/cs';
  return '#/t/' + encodeURIComponent(table);
}

function deleteButton(table, key, after) {
  return h('button', { class: 'btn danger', onclick: async () => {
    if (!await confirmDialog({ title: 'Delete this ' + humanTable(table) + '?', message: 'This removes it from the Google Sheet for everyone. It cannot be undone in the app.', confirmText: 'Delete', danger: true })) return;
    await enqueue({ op: 'delete', table, key }, 'Delete ' + humanTable(table) + ' ' + key);
    toast('Deleted.');
    location.replace(after);
  } }, iconEl('trash'), 'Delete');
}

/* ================= reference tables (companies, customers, …) ================= */

const TABLE_TITLES = { 'Lists': 'Companies', 'Customers': 'Customers', 'Locations': 'Locations', 'Item Type': 'Item categories', 'Users': 'Users', 'Stage_History': 'Stage history', 'Quality_Checks': 'Quality checks', 'Customer_Satisfaction': 'Customer satisfaction' };
const tableUi = {};

export function tableScreen(table) {
  const def = B.SCHEMA[table];
  const st = tableUi[table] || (tableUi[table] = { q: '' });
  const node = h('div');
  const body = h('div');
  node.append(h('div', { class: 'toolbar' }, searchBox(st, 'Search ' + (TABLE_TITLES[table] || table).toLowerCase(), () => draw())), body);
  function draw() {
    body.innerHTML = '';
    const cols = def.columns.map(c => c.name);
    const rows = model.view[table].filter(r => matches(r, cols, st.q)).sort((a, b) => String(a[def.label] ?? '').localeCompare(String(b[def.label] ?? '')));
    if (!rows.length) { body.append(emptyState('Nothing here', st.q ? 'No matches.' : '')); return; }
    body.append(h('div', { class: 'list', style: 'margin-top:12px' }, rows.map(r => h('a', { class: 'row', href: refHref(table, r[def.key]) },
      h('div', { class: 'main' }, h('div', { class: 'title' }, String(r[def.label] ?? r[def.key])), subLine(table, r))))));
  }
  draw();
  return { title: TABLE_TITLES[table] || table, back: '#/more', node, live: true, redraw: draw, fab: B.canAdd(table, model.user) ? { label: 'Add', href: '#/new/' + encodeURIComponent(table) } : null };
}
function subLine(table, r) {
  const t = { 'Customers': [r.Company, B.same(r.Active, 'Inactive') ? 'Inactive' : ''], 'Lists': [r['Company Code']], 'Users': [r.Departement, r.Role, r.Email] }[table];
  const s = (t || []).filter(x => !B.isBlank(x)).join(', ');
  return s ? h('div', { class: 'sub' }, s) : null;
}

export function recordScreen(table, key) {
  const def = B.SCHEMA[table];
  const node = h('div');
  function draw() {
    node.innerHTML = '';
    const r = def && findRecord(table, key);
    if (!r) { node.append(emptyState('Not found', 'It may have been deleted.')); return; }
    node.append(h('div', { class: 'hero' }, h('h2', { style: 'margin-top:0' }, String(r[def.label] ?? key)), h('div', { class: 'who' }, TABLE_TITLES[table] || table)));
    const canEdit = def.columns.some(c => ruleFor(table, c.name, r, false).editable);
    node.append(h('div', { class: 'actions-bar' },
      canEdit ? h('a', { class: 'btn', href: '#/edit/' + encodeURIComponent(table) + '/' + encodeURIComponent(key) }, iconEl('edit'), 'Edit') : null,
      B.canDelete(table, model.user) ? deleteButton(table, key, table === 'Customer_Satisfaction' || table === 'Stage_History' ? '#/p/' + encodeURIComponent(r.Project_ID) : '#/t/' + encodeURIComponent(table)) : null));
    node.append(h('div', { class: 'section' }, fieldList(table, r, def.columns.map(c => c.name))));
    related(table, r).forEach(sec => node.append(sec));
  }
  draw();
  return { title: TABLE_TITLES[table] || humanTable(table), back: '#/t/' + encodeURIComponent(table), node, live: true, redraw: draw };
}

function related(table, r) {
  const out = [];
  const projList = (title, rows) => h('div', { class: 'section' }, sectionHead(title, rows.length), rows.length ? h('div', { class: 'list' }, rows.map(p => h('a', { class: 'row', href: '#/p/' + encodeURIComponent(p['P#']) }, h('span', { class: 'pnum' }, String(p['P#'])), h('div', { class: 'main' }, h('div', { class: 'title' }, p['BD Project Name'] || p['Project Name']), rail(p.Stage, true))))) : null);
  const actList = (title, rows) => h('div', { class: 'section' }, sectionHead(title, rows.length), rows.length ? h('div', { class: 'list' }, rows.map(a => actionRow(a, true))) : null);
  if (table === 'Lists') {
    out.push(projList('Projects', model.view.Projects.filter(p => B.same(p.Company, r.Company))));
    const cs = model.view.Customers.filter(c => B.same(c.Company, r.Company));
    out.push(h('div', { class: 'section' }, sectionHead('Customers', cs.length), cs.length ? h('div', { class: 'list' }, cs.map(c => h('a', { class: 'row', href: refHref('Customers', c.Customer) }, h('div', { class: 'main' }, h('div', { class: 'title' }, c.Customer))))) : null));
  }
  if (table === 'Customers') out.push(projList('Projects', model.view.Projects.filter(p => B.same(p.Customer, r.Customer))));
  if (table === 'Locations') {
    const me = model.user ? model.user.name : '';
    out.push(actList('My Actions', model.view['Action Tracker'].filter(a => B.same(a.Location, r.Location) && B.same(a.Owner, me) && B.isOpenAction(a))));
    out.push(actList('All Actions', model.view['Action Tracker'].filter(a => B.same(a.Location, r.Location))));
  }
  if (table === 'Item Type') {
    const items = model.view.Items.filter(i => B.same(i.Item_Type, r.Item_Type));
    out.push(h('div', { class: 'section' }, sectionHead('Items', items.length), items.length ? h('div', { class: 'list' }, items.map(i => itemRow(i, findRecord('Projects', i.Project_ID)))) : null));
  }
  if (table === 'Users') out.push(actList('Actions', model.view['Action Tracker'].filter(a => B.same(a.Owner, r.Name))));
  return out;
}

/* ================= more menu ================= */

export function moreScreen() {
  const u = model.user || {};
  const node = h('div');
  node.append(h('div', { class: 'hero' }, h('h2', { style: 'margin-top:0' }, u.name || ''), h('div', { class: 'who' }, [u.email, u.dept, u.role].filter(Boolean).join(', '))));
  const link = (href, label, sub) => h('a', { class: 'row', href }, h('div', { class: 'main' }, h('div', { class: 'title' }, label), sub ? h('div', { class: 'sub' }, sub) : null));
  node.append(h('div', { class: 'section' }, sectionHead('Sync'), h('div', { class: 'list' }, link('#/sync', 'Sync and offline changes', syncSummary()))));
  node.append(h('div', { class: 'section' }, sectionHead('Lists'), h('div', { class: 'list' },
    link('#/t/Lists', 'Companies', model.view.Lists.length + ' companies'),
    link('#/t/Customers', 'Customers', model.view.Customers.length + ' customers'),
    link('#/t/Locations', 'Locations'),
    link('#/t/Item%20Type', 'Item categories'),
    link('#/t/Users', 'Users', B.PERM.manageUsers(model.user) ? 'Who can sign in, and their department and role' : 'View only'))));
  node.append(h('div', { class: 'section', style: 'padding:0 16px' }, h('button', { class: 'btn danger block', onclick: doSignOut }, 'Sign out'),
    h('p', { style: 'color:var(--ink-3);font-size:13px;text-align:center' }, 'BGS Operations ' + CONFIG.APP_VERSION)));
  return { title: 'More', node, live: true, redraw: () => {} };
}
function syncSummary() {
  const p = pendingCount(), a = attentionCount();
  return (p ? p + ' change(s) waiting to send. ' : 'Everything is sent. ') + (a ? a + ' need your attention. ' : '') + 'Last sync ' + relTime(model.lastSync) + '.';
}
async function doSignOut() {
  const p = pendingCount() + attentionCount();
  const ok = await confirmDialog({ title: 'Sign out?', message: p ? p + ' change(s) on this phone have not reached the server yet. Signing out deletes them. Sync first if you can.' : 'All data is removed from this phone. Your work is safe in the Google Sheet.', confirmText: p ? 'Sign out and delete them' : 'Sign out', danger: !!p });
  if (!ok) return;
  await signOut();
  location.hash = '#/';
}

/* ================= sync screen ================= */

export function syncScreen() {
  const node = h('div');
  function draw() {
    node.innerHTML = '';
    const stateText = { idle: 'Not synced yet', syncing: 'Syncing…', synced: 'Up to date', offline: 'Offline', failed: 'Sync failed' }[model.status] || model.status;
    node.append(h('dl', { class: 'kv', style: 'margin-top:12px' },
      h('dt', null, 'Status'), h('dd', null, stateText),
      h('dt', null, 'Last sync'), h('dd', null, relTime(model.lastSync)),
      h('dt', null, 'Waiting to send'), h('dd', null, String(pendingCount())),
      h('dt', null, 'Needs attention'), h('dd', null, String(attentionCount()))));
    if (model.statusMessage) node.append(h('div', { class: 'banner ' + (model.status === 'offline' ? 'warn' : 'error') }, model.statusMessage));
    node.append(h('div', { class: 'actions-bar' }, h('button', { class: 'btn primary', onclick: () => syncNow() }, iconEl('refresh'), 'Sync now')));

    if (model.conflicts.length) {
      node.append(h('div', { class: 'section' }, sectionHead('Conflicts', model.conflicts.length),
        h('p', { style: 'padding:0 16px;margin:0 0 8px;color:var(--ink-2)' }, 'Someone else changed the same thing first. Choose which version to keep.'),
        model.conflicts.map(k => conflictCard(k))));
    }
    const refused = model.outbox.filter(c => c.state === 'refused');
    if (refused.length) {
      node.append(h('div', { class: 'section' }, sectionHead('Not accepted by the server', refused.length),
        refused.map(c => h('div', { class: 'change' }, h('div', { class: 'what' }, c.summary), h('div', { class: 'why' }, c.message),
          h('div', { class: 'btns' }, h('button', { class: 'btn small', onclick: () => retryChange(c.seq) }, 'Try again'), h('button', { class: 'btn small danger', onclick: async () => { if (await confirmDialog({ title: 'Discard this change?', message: c.summary, confirmText: 'Discard', danger: true })) discardChange(c.seq); } }, 'Discard'))))));
    }
    const waiting = model.outbox.filter(c => c.state !== 'refused');
    if (waiting.length) {
      node.append(h('div', { class: 'section' }, sectionHead('Waiting to send', waiting.length),
        waiting.map(c => h('div', { class: 'change' }, h('div', { class: 'what' }, c.summary), h('div', { class: 'sub', style: 'font-size:13px;color:var(--ink-3)' }, 'Saved ' + relTime(c.createdAt) + (c.message ? '. ' + c.message : ''))))));
    }
  }
  draw();
  return { title: 'Sync', back: '#/more', node, live: true, redraw: draw };
}

function conflictCard(k) {
  const ch = k.change;
  const rows = (k.fields || []).map(f => h('tr', null, h('th', null, B.labelOf(ch.table, f)), h('td', null, String(ch.fields ? ch.fields[f] ?? '' : '')), h('td', null, String(k.server ? k.server[f] ?? '' : ''))));
  return h('div', { class: 'change' }, h('div', { class: 'what' }, ch.summary), h('div', { class: 'why' }, k.message),
    rows.length ? h('table', { class: 'conflict-table' }, h('tr', null, h('th', null, 'Field'), h('th', null, 'Yours'), h('th', null, 'On the server')), rows) : null,
    h('div', { class: 'btns' },
      ch.op === 'update' ? h('button', { class: 'btn small primary', onclick: () => keepMine(k.id) }, 'Keep mine') : null,
      h('button', { class: 'btn small', onclick: () => keepTheirs(k.id) }, ch.op === 'update' ? 'Keep theirs' : 'OK')));
}

/* ================= group chat (Omar, 10 Oct 2026) ================= */

const TASK_LABEL = { 'waiting': 'Waiting', 'in progress': 'Working on it', 'done': 'Done', 'needs approval': 'Needs approval', 'failed': 'Could not do it' };
let chatPoll = null;

export function chatScreen() {
  const node = h('div', { class: 'chat' });
  const me = model.user ? model.user.name : '';
  const people = model.view.Users.filter(u => u.Active !== false && !B.same(u.Active, 'Inactive') && !B.isBlank(u.Name)).map(u => u.Name);
  const ai = (model.members && model.members.length ? model.members : B.AI_MEMBERS);
  const members = h('div', { class: 'chat-members' },
    people.map(n => h('span', { class: 'mchip' }, n)),
    ai.map(m => h('span', { class: 'mchip ai', title: m.role }, m.name, h('i', null, 'AI'))));
  const note = h('div', { class: 'chat-note' }, 'Mention @Alaa or @Claude to give them a task. They check the group every hour while Omar\'s computer is on.');
  const list = h('div', { class: 'chat-list', role: 'log', 'aria-live': 'polite', 'aria-label': 'Group messages' });
  const input = h('textarea', { class: 'chat-input', rows: 1, dir: 'auto', placeholder: 'Message the group', 'aria-label': 'Message',
    oninput: () => grow(), onkeydown: e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } } });
  const sendBtn = h('button', { class: 'chat-send', 'aria-label': 'Send', html: icon.send, onclick: () => send() });
  const mention = name => h('button', { class: 'mention-btn', type: 'button', onclick: () => {
    const pre = input.value && !/\s$/.test(input.value) ? ' ' : '';
    input.value += pre + '@' + name + ' '; grow(); input.focus();
  } }, '@' + name);
  const composer = h('div', { class: 'chat-composer' }, h('div', { class: 'mentions' }, ai.map(m => mention(m.name))), h('div', { class: 'chat-row' }, input, sendBtn));
  node.append(members, note, list, composer);

  function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }
  async function send() {
    const t = input.value.trim();
    if (!t) return;
    input.value = ''; grow();
    await sendChat(t);
    draw(true);
    input.focus();
  }
  function nearBottom() { return window.innerHeight + window.scrollY >= document.body.scrollHeight - 160; }
  function draw(scroll) {
    const stick = scroll || nearBottom();
    const msgs = chatView();
    const byId = new Map(msgs.map(m => [m.Message_ID, m]));
    list.innerHTML = '';
    if (!msgs.length) list.append(emptyState('No messages yet', 'Say hello, or mention @Alaa with a design request.'));
    let day = '';
    msgs.forEach(m => {
      const d = String(m.Sent_At).slice(0, 10);
      if (d !== day) { day = d; list.append(h('div', { class: 'chat-day' }, fmtDate(d))); }
      list.append(bubble(m, byId, me));
    });
    if (stick) requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
    markChatSeen();
  }
  draw(true);
  // new messages arrive without redrawing the composer (typing is never interrupted)
  const off = onChange(kind => {
    if (!document.body.contains(node)) { off(); return; }
    if (kind === 'chat' || kind === 'change' || kind === 'applied') draw(false);
  });
  clearInterval(chatPoll);
  refreshChat();
  chatPoll = setInterval(() => {
    if (!document.body.contains(node)) { clearInterval(chatPoll); return; }
    if (document.visibilityState === 'visible') refreshChat();
  }, 15000);
  return { title: 'Group Chat', node, live: false };
}

function bubble(m, byId, me) {
  const time = String(m.Sent_At).slice(11, 16);
  if (m.Author_Type === 'system') return h('div', { class: 'chat-sys' }, h('span', { dir: 'auto' }, m.Text), h('time', null, time));
  const mine = m.Author === me && m.Author_Type === 'human';
  const quoted = m.Reply_To && byId.get(m.Reply_To);
  const body = h('div', { class: 'chat-text', dir: 'auto' }, linkify(m.Text));
  return h('div', { class: 'chat-msg' + (mine ? ' mine' : '') + (m.Author_Type === 'ai' ? ' ai' : '') },
    mine ? null : h('div', { class: 'chat-author' }, m.Author, m.Author_Type === 'ai' ? h('i', null, 'AI') : null),
    quoted ? h('div', { class: 'chat-quote', dir: 'auto' }, quoted.Author + ': ' + (quoted.Text.length > 90 ? quoted.Text.slice(0, 90) + '…' : quoted.Text)) : null,
    body,
    h('div', { class: 'chat-meta' },
      m.Task_Status ? h('span', { class: 'task-pill t-' + m.Task_Status.replace(/\s/g, '-') }, (m.Mentions || []).join(', ') + ': ' + (TASK_LABEL[m.Task_Status] || m.Task_Status)) : null,
      m.__refused ? h('span', { class: 'task-pill t-failed' }, 'Not sent: ' + m.__refused) : m.__pending ? h('span', { class: 'sending' }, 'Sending…') : null,
      h('time', null, time)));
}

/* Plain text with @mentions highlighted and web links clickable (no HTML from messages is ever run). */
function linkify(text) {
  const out = [];
  const re = /(https?:\/\/[^\s]+)|(@[\w\u0600-\u06FF]+)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(h('a', { href: m[1], target: '_blank', rel: 'noopener' }, m[1]));
    else out.push(h('span', { class: B.mentionsIn(m[2]).length ? 'mention ai' : 'mention' }, m[2]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
