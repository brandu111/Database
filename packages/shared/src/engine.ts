import { fmtDate, shift, todayISO } from './dates.js';
import { designRulesFor, isDesign } from './rules.js';
import type { Mark, MarkDate, Rule, RuleBook } from './types.js';

/**
 * The status→date cascade and rule-row engine. Ported from the design
 * prototype (`stageConfig` / `applyStage` / `ensureRuleRows` / `auRecompute` /
 * `linkDesignationRenewal`) and driven by the same rulebook. Behavior is
 * covered by the acceptance suite in `test/`.
 */

export function stageOrder(): string[] {
  return [
    'Pending',
    'Pending - Awaiting Examination',
    'Pending - Under Examination',
    'Accepted - Awaiting Advertisement',
    'Accepted',
    'Registered',
  ];
}

export function statusOptions(): string[] {
  return stageOrder().concat(['Opposed', 'Lapsed', 'Allow to lapse', 'Withdrawn', 'Watching', 'Matter settled']);
}

interface StageCfg {
  inputs?: string[];
  activate?: string[];
  activateTrigger?: string;
  extra?: { name: string; base: string; off: number; unit: 'days' | 'months' | 'years'; alert?: boolean }[];
  prompt?: boolean;
}

export function stageConfig(): Record<string, StageCfg> {
  return {
    Pending: { inputs: ['Application Filed'] },
    'Pending - Awaiting Examination': {
      inputs: ['Application Filed'],
      activate: ['Convention Priority Deadline'],
      extra: [{ name: 'OA Issued?', base: 'Application Filed', off: 5, unit: 'months', alert: true }],
    },
    'Pending - Under Examination': { inputs: ['OA Issued'], activate: ['OA Response Due'] },
    'Accepted - Awaiting Advertisement': { inputs: ['Accepted - Awaiting Advertisement'] },
    Accepted: { inputs: ['Publication Date'], activate: ['Opposition period expires'], prompt: true },
    Registered: { inputs: ['Registration Date'], activate: ['Renewal Deadline'], activateTrigger: 'Registration Date' },
  };
}

export function rulesFor(rules: RuleBook, jurisdiction: string): Rule[] {
  const list = rules[jurisdiction];
  return list && list.length ? list : rules._default || [];
}

export function ruleByName(rules: RuleBook, jurisdiction: string, name: string): Rule | undefined {
  return rulesFor(rules, jurisdiction).find((r) => r.name === name);
}

function ensureRow(m: Mark, name: string, meta?: Partial<MarkDate>): MarkDate {
  m.dates = m.dates || [];
  let row = m.dates.find((x) => x.name === name);
  if (!row) {
    row = { name, date: '', done: false };
    m.dates.push(row);
  }
  if (meta) Object.assign(row, meta);
  return row;
}

/**
 * Recompute every rule-derived date row from its base row, and maintain the
 * generated "X — Reminder k of n" rows (monthly, counting down to the
 * deadline). Idempotent; call again after base rows change.
 */
export function auRecompute(m: Mark): void {
  m.dates = m.dates || [];
  const computed = m.dates.filter((x) => x.auBase);
  computed.forEach((dr) => {
    const base = m.dates.find((x) => x.name === dr.auBase);
    const bd = base && base.date ? base.date : '';
    // Renewal rows carry a completed-cycle count so a ticked-off renewal rolls
    // to the next period; every other row has auCycle 0 (multiplier 1, no change).
    const cyc = Math.trunc(Number(dr.auCycle)) || 0;
    // A pinned row keeps its manually-set date; only its reminders recompute.
    if (!(dr.pinned && dr.date)) dr.date = bd ? shift(bd, (dr.auOff || 0) * (cyc + 1), dr.auUnit || 'months') : '';
    const rem = Math.trunc(Number(dr.auRem)) || 0;
    for (let k = 1; k <= 6; k++) {
      const rn = `${dr.name} — Reminder ${k} of ${rem}`;
      const ex = m.dates.findIndex((x) => x.name === rn);
      if (k <= rem && dr.date) {
        const rd = shift(dr.date, -(rem - k + 1), 'months');
        if (ex < 0) m.dates.push({ name: rn, date: rd, done: false, reminder: true, emailFor: dr.name, auGen: true });
        else {
          m.dates[ex].date = rd;
          m.dates[ex].emailFor = dr.name;
        }
      } else if (ex >= 0 && m.dates[ex].auGen) {
        m.dates.splice(ex, 1);
      }
    }
    // Universal "1 week before" reminder for every alerting deadline. Excludes
    // reminder rows, grace periods and the "OA Issued?" prompt (which are not
    // themselves deadlines).
    const isDeadline = dr.auAlert && (dr.auOff || 0) > 0 && !dr.reminder && !/grace|issued\?|headstart/i.test(dr.name);
    const wkName = `${dr.name} — 1 Week Reminder`;
    const wex = m.dates.findIndex((x) => x.name === wkName);
    if (isDeadline && dr.date) {
      const wd = shift(dr.date, -7, 'days');
      if (wex < 0) m.dates.push({ name: wkName, date: wd, done: false, reminder: true, emailFor: dr.name, auGen: true });
      else { m.dates[wex].date = wd; m.dates[wex].emailFor = dr.name; }
    } else if (wex >= 0 && m.dates[wex].auGen) {
      m.dates.splice(wex, 1);
    }
  });
  m.dates = m.dates.filter((x) => !(x.reminder && x.auGen && !x.date));
}

/** True for rules that only make sense once a registration exists. */
const POST_REGISTRATION = /renewal|non-use|declaration of use|dependency|\bdau\b|statement of use|grace/i;

/**
 * Activate every rule whose trigger date is present on the mark.
 * Post-registration rules (renewal chain, non-use, declarations of use,
 * dependency, statement of use, grace) are gated behind a present
 * Registration Date; all other rules fire as soon as their own trigger date
 * exists. Runs on manual date entry and on "Add date", not only on status
 * change — entering dates by hand cascades correctly.
 *
 * `allMarks` supplies Madrid family members so a designation's renewal can be
 * linked to (and re-propagated from) its parent International Registration.
 */
export function ensureRuleRows(m: Mark, rules: RuleBook, allMarks?: Mark[], caseUpdateMonths = 3): void {
  if (!m) return;
  // Registered designs use their own renewal cycle / maximum-term rules rather
  // than the trade-mark rulebook.
  const list = isDesign(m.type) ? designRulesFor(m.jurisdiction) : rulesFor(rules, m.jurisdiction);
  const val = (n: string) => {
    const row = (m.dates || []).find((x) => x.name === n);
    return row && row.date;
  };
  const regPresent = val('Registration Date');
  // A Madrid International Registration renews from its own filing (international
  // registration) date, so its post-registration rules fire as soon as their
  // trigger date exists rather than waiting for a separate registration date.
  // (The UI hides the renewal rows on Madrid cases until they are registered.)
  const isMadridIr = m.jurisdiction === 'Madrid Protocol (WIPO)';
  // Convention Priority only applies to Australian and New Zealand cases, and
  // never to a Madrid International Registration or its designations (an IR is
  // never AU/NZ; a designation carries an irId).
  const conventionAllowed = ['Australia', 'New Zealand'].includes(m.jurisdiction) && !m.irId;
  // Rows the user deleted by hand stay deleted — the engine must not recreate them.
  const suppressed = new Set(m.suppressedRules || []);
  const generate = () => list.forEach((r) => {
    if (!r.name || !r.trigger) return;
    if (suppressed.has(r.name)) return;
    if (/convention priority/i.test(r.name) && !conventionAllowed) return;
    // Post-registration gate, except deadlines driven by a specific manual event
    // date rather than a registration date: the Philippines DAU (from the filing /
    // designation date) and the Mexico renewal declaration (from the date IMPI
    // records WIPO's renewal notice). Those activate as soon as their own trigger
    // date exists, and stay dormant until then.
    const eventAnchored =
      (/\bdau\b|declaration of use/i.test(r.name) && r.trigger === 'Application Filed') ||
      r.trigger === 'WIPO renewal notice recorded by IMPI';
    const post = POST_REGISTRATION.test(r.name) && !eventAnchored;
    const gateOk = post ? (isMadridIr ? !!val(r.trigger) : regPresent) : val(r.trigger);
    if (!gateOk) return;
    ensureRow(m, r.name, { auBase: r.trigger, auOff: r.v, auUnit: r.u, auRem: Math.trunc(Number(r.rem)) || 0, auAlert: r.alerts });
  });
  // Two generation passes with a compute in between, so a rule whose trigger is
  // itself a computed date (a chained deadline, e.g. the Headstart Part 2 fee
  // reminder that hangs off the computed Part 2 Fee Due date) is created once its
  // trigger has a value.
  generate();
  auRecompute(m);
  generate();
  // Remove any auto-generated Convention Priority rows that shouldn't be here
  // (e.g. on a Madrid designation), along with their reminder rows.
  if (!conventionAllowed) {
    m.dates = (m.dates || []).filter((d) => !(/convention priority/i.test(d.name) && (d.auBase || d.auGen)));
  }
  // Universal "Case update" task: three months after an application is filed, on
  // every matter regardless of jurisdiction. Created only while still upcoming so
  // it never retroactively floods long-filed cases with an overdue task; kept in
  // sync with the filing date unless pinned/edited, and not recreated once the
  // user deletes it.
  const filedForUpdate = val('Application Filed');
  const cuMonths = Number.isFinite(caseUpdateMonths) && caseUpdateMonths > 0 ? caseUpdateMonths : 3;
  if (filedForUpdate && !suppressed.has('Case update')) {
    const due = shift(filedForUpdate, cuMonths, 'months');
    const existing = (m.dates || []).find((d) => d.name === 'Case update');
    if (existing) {
      if (!existing.pinned) existing.date = due;
    } else if (due >= todayISO()) {
      m.dates.push({ name: 'Case update', date: due, done: false, notify: true });
    }
  }
  // --- Australian Headstart workflow --------------------------------------
  // Entering the "Preliminary Assessment Received" date closes off the earlier
  // "Preliminary Assessment Received?" chase reminder automatically.
  if ((m.dates || []).some((d) => d.name === 'Headstart - Preliminary Assessment Received' && d.date)) {
    const prompt = (m.dates || []).find((d) => d.name === 'Headstart - Preliminary Assessment Received?');
    if (prompt && !prompt.done) prompt.done = true;
  }
  // Once the Part 2 fee reminder is ticked (fee paid), the Headstart becomes a
  // full application: open up the standard "Application Filed" date for entry.
  if (
    (m.dates || []).some((d) => d.name === 'Headstart - Has the Part 2 Fee been Paid' && d.done) &&
    !(m.dates || []).some((d) => d.name === 'Application Filed')
  ) {
    m.dates.push({ name: 'Application Filed', date: '', done: false });
  }
  rollCompletedRenewals(m);
  // Two passes so rows whose base was itself just computed resolve in one call.
  auRecompute(m);
  auRecompute(m);
  if (allMarks) {
    linkDesignationRenewal(m, allMarks);
    allMarks.filter((x) => x.irId === m.id).forEach((des) => linkDesignationRenewal(des, allMarks));
  }
}

/**
 * When the current renewal deadline is ticked off, the completed one is kept as
 * a frozen history row (its original date, still ticked) and the active
 * "Renewal Deadline" rolls forward to the next period with fresh reminders. So
 * the old date stays visible — you just complete it — and the next renewal
 * appears automatically. Designation renewals (linkedToIR) follow their
 * International Registration, so they are left for `linkDesignationRenewal`.
 */
function rollCompletedRenewals(m: Mark): void {
  const design = isDesign(m.type);
  const maxTerm = design ? (m.dates || []).find((d) => d.name === 'Design Maximum Term Ends')?.date : '';
  // Only the single canonical active row rolls; archived rows have other names.
  for (const ren of (m.dates || []).filter((d) => d.name === 'Renewal Deadline' && !d.linkedToIR)) {
    if (!ren.done || !ren.date) continue;
    const oldDate = ren.date;
    const step = ren.auOff || (design ? 5 : 10);
    // Registered designs stop at their maximum registration term — once the next
    // period would reach/exceed that, the completed renewal is the last one.
    const nextDate = shift(oldDate, step, ren.auUnit || 'years');
    if (design && maxTerm && nextDate >= maxTerm) {
      ren.note = 'Final renewal — maximum registration term reached';
      continue;
    }
    // Preserve the completed renewal as a frozen, ticked history row.
    const archName = `Renewal Deadline — ${fmtDate(oldDate)} (completed)`;
    if (!(m.dates || []).some((x) => x.name === archName)) {
      m.dates.push({ name: archName, date: oldDate, done: true, pinned: true });
    }
    // Roll the active renewal forward to the next period and reopen it.
    ren.auCycle = (Math.trunc(Number(ren.auCycle)) || 0) + 1;
    ren.done = false;
    ren.note = 'Next renewal deadline';
    // A pinned renewal isn't recomputed by auRecompute, so advance it here.
    if (ren.pinned || !ren.auBase) ren.date = nextDate;
    // Reopen the reminder / grace rows for the new cycle.
    (m.dates || []).forEach((r) => {
      if (r === ren) return;
      if (r.emailFor === 'Renewal Deadline' || r.name.startsWith('Renewal Deadline — Reminder') || /renewal (reminder|grace)/i.test(r.name)) r.done = false;
    });
  }
}

/**
 * A Madrid designation does not compute its own renewal — it copies the
 * parent International Registration's Renewal Deadline (and the reminder /
 * grace rows) and marks the row `linkedToIR`. Changing the IR's renewal
 * re-propagates to all designations.
 */
export function linkDesignationRenewal(m: Mark, allMarks: Mark[]): void {
  if (!m || !m.irId) return;
  const ir = allMarks.find((x) => x.id === m.irId);
  if (!ir) return;
  const irRen = (ir.dates || []).find((x) => x.name === 'Renewal Deadline');
  if (!irRen || !irRen.date) return;
  m.dates = m.dates || [];
  let row = m.dates.find((x) => x.name === 'Renewal Deadline');
  if (!row) {
    row = { name: 'Renewal Deadline', date: '', done: false };
    m.dates.push(row);
  }
  // If the IR renewal rolled forward to a new cycle, the designation follows and
  // its renewal (and reminders) reopen for the new period.
  if (row.date && row.date !== irRen.date) {
    row.done = false;
    m.dates.forEach((r) => { if (r.emailFor === 'Renewal Deadline' || /renewal (reminder|grace)/i.test(r.name)) r.done = false; });
  }
  row.date = irRen.date;
  row.auBase = '';
  row.linkedToIR = true;
  row.note = 'Linked to IR renewal date';
  (
    [
      ['Renewal Reminder', -6, 'months'],
      ['Renewal Reminder - Final', -2, 'months'],
      ['Renewal Reminder - 1 Week', -7, 'days'],
      ['6 Month Renewal Grace Period', 6, 'months'],
    ] as const
  ).forEach(([nm, off, u]) => {
    let rr = m.dates.find((x) => x.name === nm);
    const dt = shift(row.date, off, u);
    if (!rr) {
      rr = { name: nm, date: '', done: false, reminder: /Reminder/.test(nm), auGen: true, emailFor: 'Renewal Deadline' };
      m.dates.push(rr);
    }
    rr.date = dt;
  });
}

/**
 * Run the stage transition for a status change: seed the stage's manual input
 * rows, activate its rules, then recompute. The Convention Priority Deadline
 * is only auto-activated for Australian and New Zealand cases.
 */
export function applyStage(m: Mark, rules: RuleBook, status: string): void {
  const cfg = stageConfig()[status];
  if (!cfg) return;
  // Designs draw from their own rulebook, not the trade-mark rules.
  const design = isDesign(m.type);
  const list = design ? designRulesFor(m.jurisdiction) : rulesFor(rules, m.jurisdiction);
  const byName = (n: string) => list.find((r) => r.name === n);
  (cfg.inputs || []).forEach((n) => ensureRow(m, n, { auInput: true }));
  (cfg.activate || []).forEach((n) => {
    if (n === 'Convention Priority Deadline' && (!['Australia', 'New Zealand'].includes(m.jurisdiction) || m.irId)) return;
    const r = byName(n);
    if (r) ensureRow(m, n, { auBase: r.trigger, auOff: r.v, auUnit: r.u, auRem: Math.trunc(Number(r.rem)) || 0, auAlert: r.alerts });
  });
  if (cfg.activateTrigger) {
    list
      .filter((r) => r.trigger === cfg.activateTrigger && r.name)
      .forEach((r) => ensureRow(m, r.name, { auBase: r.trigger, auOff: r.v, auUnit: r.u, auRem: Math.trunc(Number(r.rem)) || 0, auAlert: r.alerts }));
  }
  (cfg.extra || []).forEach((e) => ensureRow(m, e.name, { auBase: e.base, auOff: e.off, auUnit: e.unit, auRem: 0, auAlert: !!e.alert }));
  if (cfg.prompt) m.promptEmail = true;
  auRecompute(m);
}
