/* =====================================================================
 * BGS Operations — SHARED BUSINESS RULES
 *
 * This ONE file is used in two places and must stay identical:
 *   1. app/js/shared.js      (the web app, to show/hide buttons and fields)
 *   2. backend/Shared.gs     (the Google Apps Script API, to enforce them)
 * The test "npm test" fails if the two copies differ.
 * To change a rule: edit app/js/shared.js, then run tools/copy-shared
 * (or paste the same text into backend/Shared.gs).
 *
 * Every rule below is copied from the AppSheet documentation
 * ("Application Documentation 003"). Lines marked DECISION record a
 * change Omar approved on 5 Oct 2026.
 * ===================================================================== */

var BGS = (function () {
  'use strict';

  var VERSION = '1.0.0';

  /* ---------- Project stages (SOURCE: Projects.Stage enum) ---------- */
  var S1 = '1- Approaching', S2 = '2- Pricing', S3 = '3- Waiting for Approval',
      S4 = '4- Executing', S5 = '5- Waiting for Payment', S6 = '6- Done', S7 = '7- Rejected';
  var STAGES = [S1, S2, S3, S4, S5, S6, S7];

  /* ---------- Departments and roles (SOURCE: Users sheet) ---------- */
  var DEPT = { MGMT: 'Management', OPS: 'Operations', BD: 'Business Development', IT: 'IT' };
  var ROLE = { ADMIN: 'Admin', CS: 'Customer Satisfaction', CSS: 'Customer Satisfaction Specialist' };

  /* ---------- Tables and columns (SOURCE: AppSheet schemas) ----------
   * type: text | longtext | number | price | decimal | date | datetime |
   *       bool | enum | ref | email | file | image
   * auto: the API fills it in; the user never types it.            */
  var SCHEMA = {
    'Projects': {
      sheet: 'Projects', key: 'P#', keyType: 'number', label: 'BD Project Name', canDelete: false,
      columns: [
        { name: 'P#', type: 'number', label: 'P#', auto: true },
        { name: 'Project Name', type: 'text' },
        { name: 'BD Project Name', type: 'text', auto: true },
        { name: 'Company', type: 'ref', ref: 'Lists' },
        { name: 'Customer', type: 'ref', ref: 'Customers' },
        { name: 'Stage', type: 'enum', values: STAGES, auto: true },
        { name: 'Execution_Started_At', type: 'date', label: 'Execution Started At', auto: true },
        { name: 'Criticality', type: 'text' },
        { name: 'Contract#', type: 'text', label: 'Contract #' },
        { name: 'Quotation_No', type: 'text', label: 'Quotation Number' },
        { name: 'PO_No', type: 'text', label: 'PO Number' },
        { name: 'Invoice#', type: 'text', label: 'Invoice Number' },
        { name: 'Expected Cash In', type: 'date' },
        { name: 'Documentation_Verified', type: 'bool', label: 'Documentation Verified' },
        { name: 'Satisfaction_Completed', type: 'text', label: 'Satisfaction Completed' },
        { name: 'Created_By', type: 'email', label: 'Created By', auto: true },
        { name: 'Rejection Reason', type: 'text' },
        { name: 'Quotation', type: 'file' },
        { name: 'PO', type: 'file' },
        { name: 'Invoice', type: 'file' }
      ]
    },
    'Items': {
      sheet: 'Items', key: 'Item_ID', keyType: 'text', label: 'Item_Name', parent: { table: 'Projects', column: 'Project_ID' },
      columns: [
        { name: 'Project_ID', type: 'ref', ref: 'Projects', label: 'Project #', auto: true },
        { name: 'BD Project Name', type: 'text', auto: true },
        { name: 'Item_ID', type: 'text', label: 'Item #', auto: true },
        { name: 'Item_Name', type: 'text', label: 'Item Description' },
        { name: 'Item_Type', type: 'ref', ref: 'Item Type', label: 'Item Category' },
        { name: 'Specification', type: 'text' },
        { name: 'Qty', type: 'number' },
        { name: 'Lead_Time_Days', type: 'number', label: 'Lead Time in Days' },
        { name: 'Estimated_Cost', type: 'price', label: 'Estimated Cost' },
        { name: 'Selling_Price', type: 'price', label: 'Selling Price' },
        { name: 'Delivered', type: 'bool' },
        { name: 'Delivery_Date', type: 'date', label: 'Promised Date' },
        { name: 'Execution_Photos', type: 'image', label: 'Execution Photo' }
      ]
    },
    'Users': {
      sheet: 'Users', key: 'Name', keyType: 'text', label: 'Name',
      columns: [
        { name: 'Email', type: 'email' },
        { name: 'Name', type: 'text' },
        { name: 'Role', type: 'text' },
        { name: 'Active', type: 'bool' },
        { name: 'Departement', type: 'text', label: 'Department' }
      ]
    },
    'Stage_History': {
      sheet: 'Stage_History', key: 'History_ID', keyType: 'text', label: 'History_ID', parent: { table: 'Projects', column: 'Project_ID' },
      columns: [
        { name: 'History_ID', type: 'text', label: 'History ID', auto: true },
        { name: 'Project_ID', type: 'ref', ref: 'Projects', label: 'Project #' },
        { name: 'From_Stage', type: 'text', label: 'From Stage' },
        { name: 'To_Stage', type: 'text', label: 'To Stage' },
        { name: 'Changed_By', type: 'text', label: 'Changed By', auto: true },
        { name: 'Changed_At', type: 'datetime', label: 'Changed At', auto: true },
        { name: 'Comment', type: 'longtext' }
      ]
    },
    'Quality_Checks': {
      sheet: 'Quality_Checks', key: 'Check_ID', keyType: 'text', label: 'Check_ID',
      columns: [
        { name: 'Check_ID', type: 'text', label: 'Check ID', auto: true },
        { name: 'Item_ID', type: 'text', label: 'Item #' },
        { name: 'Check', type: 'text' },
        { name: 'Result', type: 'text' },
        { name: 'Comment', type: 'longtext' },
        { name: 'Checked_By', type: 'text', label: 'Checked By' },
        { name: 'Checked_At', type: 'text', label: 'Checked At' }
      ]
    },
    'Customer_Satisfaction': {
      sheet: 'Customer_Satisfaction', key: 'Satisfaction_ID', keyType: 'text', label: 'Satisfaction_ID', parent: { table: 'Projects', column: 'Project_ID' },
      columns: [
        { name: 'Satisfaction_ID', type: 'text', label: 'Satisfaction ID', auto: true },
        { name: 'Project_ID', type: 'ref', ref: 'Projects', label: 'Project #' },
        { name: 'Overall_Rating', type: 'text', label: 'Overall Rating', rating: true },
        { name: 'Delivery_Rating', type: 'text', label: 'Delivery Rating', rating: true },
        { name: 'Quality_Rating', type: 'text', label: 'Quality Rating', rating: true },
        { name: 'Communication_Rating', type: 'text', label: 'Communication Rating', rating: true },
        { name: 'Comments', type: 'longtext' },
        { name: 'Submitted_By', type: 'email', label: 'Submitted By', auto: true },
        { name: 'Submitted_At', type: 'datetime', label: 'Submitted At', auto: true }
      ]
    },
    'Lists': {
      sheet: 'Lists', key: 'Company', keyType: 'text', label: 'Company',
      columns: [
        { name: 'Company', type: 'text' },
        { name: 'Company Code', type: 'text' },
        { name: 'Item_Type', type: 'text', label: 'Item Type', optional: true }
      ]
    },
    'Customers': {
      sheet: 'Customers', key: 'Customer', keyType: 'text', label: 'Customer',
      columns: [
        { name: 'Customer', type: 'text' },
        { name: 'Company', type: 'ref', ref: 'Lists' },
        { name: 'Active', type: 'bool' }
      ]
    },
    'Action Tracker': {
      sheet: 'Action Tracker', key: 'Action #', keyType: 'number', label: 'Action', parent: { table: 'Projects', column: 'Project #' },
      columns: [
        { name: 'Action #', type: 'number', auto: true },
        // DECISION (5 Oct 2026, Omar): the project can be chosen when creating an
        // action (AppSheet: read-only, set only from the project screen).
        { name: 'Project #', type: 'ref', ref: 'Projects', label: 'Project' },
        { name: 'BD Project Name', type: 'text', auto: true },
        { name: 'Criticality', type: 'text', auto: true },
        { name: 'Action', type: 'text' },
        // SOURCE: Owner is editable, starting as the signed-in user's name.
        { name: 'Owner', type: 'ref', ref: 'Users' },
        { name: 'Created at', type: 'date' },
        { name: 'Due Date', type: 'date' },
        { name: 'Status', type: 'text', auto: true },
        { name: 'Estimated Time', type: 'decimal', label: 'Estimated Time (hours)' },
        { name: 'Location', type: 'ref', ref: 'Locations' }
      ]
    },
    'Locations': {
      sheet: 'Locations', key: 'Location', keyType: 'text', label: 'Location',
      columns: [{ name: 'Location', type: 'text' }]
    },
    'Item Type': {
      sheet: 'Item Type', key: 'Item_Type', keyType: 'text', label: 'Item_Type',
      columns: [{ name: 'Item_Type', type: 'text', label: 'Item Category' }]
    }
  };

  /* ---------- small helpers ---------- */
  function norm(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function same(a, b) { return norm(a).toLowerCase() === norm(b).toLowerCase(); }
  function isBlank(v) { return norm(v) === ''; }
  function inList(v, list) { for (var i = 0; i < list.length; i++) { if (same(v, list[i])) return true; } return false; }
  function isTrue(v) { return v === true || inList(v, ['TRUE', 'Yes', 'Y']); }
  function column(table, name) {
    var cols = SCHEMA[table].columns;
    for (var i = 0; i < cols.length; i++) { if (cols[i].name === name) return cols[i]; }
    return null;
  }
  function labelOf(table, name) { var c = column(table, name); return (c && c.label) || name; }
  function stageIndex(stage) { for (var i = 0; i < STAGES.length; i++) { if (same(stage, STAGES[i])) return i + 1; } return 0; }
  function stageIn(stage, list) { return inList(stage, list); }

  /* ---------- who may do what ---------- */
  function deptIn(user, list) { return !!user && inList(user.dept, list); }
  function roleIn(user, list) { return !!user && inList(user.role, list); }

  var PERM = {
    // DECISION (F1): AppSheet checked Role = "Management", which no user has.
    // Corrected to Department = Management.
    seeDoneProjects: function (u) { return deptIn(u, [DEPT.MGMT]); },
    // SOURCE: "Projects" view Show_If
    seeAllProjectsMenu: function (u) { return deptIn(u, [DEPT.MGMT]); },
    // SOURCE: "Customer Satisfaction" view Show_If (Role = "Customer Satisfaction").
    // DECISION (F2): also shown to "Customer Satisfaction Specialist".
    seeSatisfactionMenu: function (u) { return roleIn(u, [ROLE.CS, ROLE.CSS]); },
    // SOURCE: Contract# Show_If
    seeContract: function (u) { return deptIn(u, [DEPT.IT, DEPT.MGMT]); },
    // SOURCE: Invoice#, Invoice, Expected Cash In, Documentation_Verified,
    // Satisfaction_Completed, Related Customer_Satisfactions Show_If
    seeFinance: function (u) { return deptIn(u, [DEPT.BD, DEPT.MGMT]); },
    // SOURCE: Documentation_Verified Editable_If
    verifyDocs: function (u) { return roleIn(u, [ROLE.ADMIN, ROLE.CSS]); },
    // NEW (security): the Users sheet now controls who can sign in, so only
    // Management may change it. AppSheet allowed everyone.
    manageUsers: function (u) { return deptIn(u, [DEPT.MGMT]); }
  };

  /* Columns the API never sends to a user who may not see them. */
  function hiddenColumnsFor(table, user) {
    var out = [];
    if (table === 'Projects') {
      if (!PERM.seeContract(user)) out.push('Contract#');
      if (!PERM.seeFinance(user)) out.push('Invoice#', 'Invoice', 'Expected Cash In', 'Documentation_Verified', 'Satisfaction_Completed');
    }
    return out;
  }

  /* SOURCE: Projects security filter, with DECISION F1. */
  function canSeeProject(project, user) {
    return PERM.seeDoneProjects(user) || !same(project.Stage, S6);
  }

  /* ---------- field rules: visible / editable / required ----------
   * row      = the record (for a new record: its starting values)
   * user     = {email, name, role, dept}
   * ctx      = { parent: parent project row (Items), isNew: bool }
   * returns {visible, editable, required}                           */
  function fieldRule(table, col, row, user, ctx) {
    ctx = ctx || {};
    row = row || {};
    var r = { visible: true, editable: true, required: false };
    var def = column(table, col);
    if (def && def.auto) r.editable = false;
    var st = row.Stage;

    if (table === 'Projects') {
      switch (col) {
        case 'P#': case 'Created_By': case 'Execution_Started_At':
          r.visible = false; r.editable = false; break;
        case 'Project Name': case 'Customer':
          r.visible = same(st, S1); break;
        case 'Company':
          r.editable = same(st, S1); break;
        case 'Contract#':
          r.visible = PERM.seeContract(user) && same(st, S4); break;
        case 'Quotation_No': case 'Quotation':
          r.visible = same(st, S2); break;
        case 'PO_No': case 'PO':
          r.visible = same(st, S3); break;
        case 'Invoice#': case 'Invoice': case 'Expected Cash In': case 'Satisfaction_Completed':
          r.visible = PERM.seeFinance(user) && same(st, S5); break;
        case 'Documentation_Verified':
          r.visible = PERM.seeFinance(user) && same(st, S5);
          r.editable = PERM.verifyDocs(user); break;
        case 'Rejection Reason':
          r.visible = same(st, S7) || !isBlank(row['Rejection Reason']);
          r.required = same(st, S7); break;
      }
    } else if (table === 'Items') {
      var ps = ctx.parent ? ctx.parent.Stage : '';
      var early = stageIn(ps, [S1, S2]);
      var fromPricing = stageIn(ps, [S2, S3, S4, S5, S6, S7]);
      var fromExec = stageIn(ps, [S4, S5, S6, S7]);
      switch (col) {
        case 'Item_Name': case 'Item_Type': case 'Specification': case 'Qty':
          r.editable = early; break;
        case 'Lead_Time_Days':
          r.visible = fromPricing; r.editable = early; break;
        case 'Estimated_Cost':
          r.editable = same(ps, S2); break;
        case 'Selling_Price':
          r.visible = fromPricing; r.editable = same(ps, S2); break;
        case 'Delivered': case 'Execution_Photos':
          r.visible = fromExec; break;
        case 'Delivery_Date':
          r.visible = fromPricing; break;
      }
    } else if (table === 'Action Tracker') {
      if (col === 'Action #') { r.visible = false; r.editable = false; }
      if (col === 'Project #') { r.visible = !!ctx.isNew; r.editable = !!ctx.isNew; }
    } else if (table === 'Users') {
      r.editable = PERM.manageUsers(user);
    }
    // a key that the user types (e.g. a new Company) can be set only when creating
    var sch = SCHEMA[table];
    if (sch && col === sch.key && !(def && def.auto)) r.editable = !!ctx.isNew && (table !== 'Users' || PERM.manageUsers(user));
    if (!r.visible) r.editable = false;
    return r;
  }

  /* Can this user add / delete records in this table? */
  function canAdd(table, user) {
    if (table === 'Users') return PERM.manageUsers(user);
    return true; // SOURCE: every table has an unrestricted "Add" action
  }
  function canDelete(table, user) {
    if (table === 'Projects') return false; // SOURCE: ADDS_AND_UPDATES only
    if (table === 'Users') return PERM.manageUsers(user);
    return true; // SOURCE: Delete actions have no condition
  }

  /* ---------- Customer choices (SOURCE: Customer Valid_If) ---------- */
  function customersForCompany(company, customers) {
    var out = [];
    for (var i = 0; i < customers.length; i++) {
      var c = customers[i];
      if (same(c.Company, company) && !same(c.Active, 'Inactive')) out.push(c);
    }
    return out;
  }

  /* ---------- Stage moves (SOURCE: the six "Move to …" actions) ----------
   * data = { items: [items of this project], satisfactions: [records of this project] }
   * Each check returns a list of reasons; an empty list means "allowed".   */
  /* List what each item still needs, e.g. "Item 563-01: Lead Time, Selling Price".
   * At most 5 items are named; the rest are counted. */
  function itemNeeds(items, needsOf) {
    var out = [], more = 0;
    for (var i = 0; i < items.length; i++) {
      var need = needsOf(items[i]);
      if (!need.length) continue;
      if (out.length < 5) out.push('Item ' + (norm(items[i].Item_ID) || 'not yet numbered') + ' (' + (norm(items[i].Item_Name) || 'no description') + '): ' + need.join(', '));
      else more++;
    }
    if (more) out.push('and ' + more + ' more item(s)');
    return out;
  }

  var MOVES = [
    { name: 'Move to Pricing', from: S1, to: S2, depts: [DEPT.OPS, DEPT.MGMT],
      check: function (p, d) {
        var out = [];
        if (isBlank(p.Company)) out.push('Company is empty');
        if (isBlank(p.Customer)) out.push('Customer is empty');
        if (d.items.length === 0) out.push('No items yet: add at least one item');
        return out;
      } },
    { name: 'Move to Waiting for Approval', from: S2, to: S3, depts: [DEPT.OPS, DEPT.MGMT],
      check: function (p, d) {
        var out = [];
        if (isBlank(p.Quotation_No)) out.push('Quotation Number is empty');
        return out.concat(itemNeeds(d.items, function (it) {
          var n = [];
          if (isBlank(it.Lead_Time_Days)) n.push('Lead Time');
          if (isBlank(it.Estimated_Cost)) n.push('Estimated Cost');
          if (isBlank(it.Selling_Price)) n.push('Selling Price');
          return n;
        }));
      } },
    { name: 'Move to Executing', from: S3, to: S4, depts: [DEPT.OPS, DEPT.MGMT],
      sets: { 'Execution_Started_At': 'today' },
      check: function (p) { return isBlank(p.PO_No) ? ['PO Number is empty'] : []; } },
    { name: 'Move to Waiting for Payment', from: S4, to: S5, depts: [DEPT.OPS, DEPT.MGMT],
      check: function (p, d) {
        return itemNeeds(d.items, function (it) {
          var n = [];
          if (!isTrue(it.Delivered)) n.push('mark as Delivered');
          if (isBlank(it.Execution_Photos)) n.push('add an execution photo');
          return n;
        });
      } },
    { name: 'Move to Done', from: S5, to: S6, depts: [DEPT.BD, DEPT.MGMT],
      check: function (p, d) {
        var out = [];
        if (isBlank(p['Invoice#'])) out.push('Invoice Number is empty');
        if (!isTrue(p.Documentation_Verified)) out.push('Documentation is not verified');
        if (d.satisfactions.length === 0) out.push('No customer satisfaction record yet');
        return out;
      } }
  ];

  /* Department names for "who may do this" notes. */
  function deptNames(list) { return list.join(' or '); }

  /* The next move for a project, with whether this user may do it now. */
  function nextMove(project, user, data) {
    for (var i = 0; i < MOVES.length; i++) {
      var m = MOVES[i];
      if (same(project.Stage, m.from)) {
        var allowedUser = deptIn(user, m.depts);
        var reasons = m.check(project, data || { items: [], satisfactions: [] });
        return { move: m, userAllowed: allowedUser, reasons: reasons, ok: allowedUser && reasons.length === 0 };
      }
    }
    return null;
  }
  function moveTo(target) {
    for (var i = 0; i < MOVES.length; i++) { if (same(MOVES[i].to, target)) return MOVES[i]; }
    return null;
  }

  /* Step back one stage (e.g. Pricing -> Approaching).
   * DECISION (Omar, 9 Oct 2026): anyone may do it, from stages 2-6, no reason
   * asked; Stage_History records it. Rejected projects cannot step back. */
  function previousStage(project) {
    var i = stageIndex(project.Stage);
    return (i >= 2 && i <= 6) ? STAGES[i - 2] : null;
  }

  /* SOURCE: "Move to Rejected" — anyone, unless stage is 5, 6 or 7. */
  function canReject(project) { return !stageIn(project.Stage, [S5, S6, S7]); }

  /* ---------- Action Tracker status (SOURCE: Status initial value + Reset_If) ---------- */
  function isOpenAction(a) { return !inList(a.Status, ['Completed', 'Closed']); }
  function statusForNewAction(due, today) { return (!isBlank(due) && norm(due) < today) ? 'Late' : 'In Progress'; }
  function statusAfterEdit(action, today) {
    var due = norm(action['Due Date']);
    if (isOpenAction(action) && /^\d{4}-\d{2}-\d{2}$/.test(due)) {
      if (due < today) return 'Late';
      // due date moved to today or later: no longer late (SOURCE: Status initial value formula)
      if (same(action.Status, 'Late')) return 'In Progress';
    }
    return action.Status;
  }

  /* ---------- Items: selling price (SOURCE: Selling_Price initial + Reset_If) ---------- */
  function sellingPriceRule(item) {
    var sp = item.Selling_Price;
    if (isBlank(sp) || Number(sp) === 0) {
      var cost = Number(item.Estimated_Cost);
      if (!isBlank(item.Estimated_Cost) && !isNaN(cost)) return Math.round(cost * 1.5 * 100) / 100;
    }
    return sp;
  }

  /* ---------- Group chat: AI team members (Omar, 10 Oct 2026) ----------
   * Mentioning one of them ("@Alaa", "@آلاء", "@Claude") turns a message into a
   * task for them. They answer through an hourly scheduled Claude task. */
  var AI_MEMBERS = [
    { name: 'Alaa', role: 'Tasmim graphic designer (AI)', handles: ['alaa', 'آلاء', 'الاء', 'ألاء', 'إلاء'] },
    { name: 'Claude', role: 'Assistant (AI)', handles: ['claude', 'كلود'] }
  ];
  function mentionsIn(text) {
    var t = String(text || '').toLowerCase(), out = [];
    AI_MEMBERS.forEach(function (m) {
      for (var i = 0; i < m.handles.length; i++) {
        if (t.indexOf('@' + m.handles[i].toLowerCase()) >= 0) { out.push(m.name); return; }
      }
    });
    return out;
  }

  /* SOURCE: BD Project Name initial value */
  function bdProjectName(pnum, companyCode, projectName) {
    return pnum + '. ' + norm(companyCode) + ' - ' + norm(projectName);
  }

  return {
    VERSION: VERSION, STAGES: STAGES, S: { S1: S1, S2: S2, S3: S3, S4: S4, S5: S5, S6: S6, S7: S7 },
    DEPT: DEPT, ROLE: ROLE, SCHEMA: SCHEMA, PERM: PERM, MOVES: MOVES,
    norm: norm, same: same, isBlank: isBlank, isTrue: isTrue, inList: inList,
    column: column, labelOf: labelOf, stageIndex: stageIndex,
    hiddenColumnsFor: hiddenColumnsFor, canSeeProject: canSeeProject,
    fieldRule: fieldRule, canAdd: canAdd, canDelete: canDelete,
    customersForCompany: customersForCompany, nextMove: nextMove, deptNames: deptNames, previousStage: previousStage, moveTo: moveTo, canReject: canReject,
    isOpenAction: isOpenAction, statusForNewAction: statusForNewAction, statusAfterEdit: statusAfterEdit,
    sellingPriceRule: sellingPriceRule, bdProjectName: bdProjectName,
    AI_MEMBERS: AI_MEMBERS, mentionsIn: mentionsIn
  };
})();
