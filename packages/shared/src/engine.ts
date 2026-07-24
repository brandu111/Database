import { shift } from './dates.js';
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
    'Accepted - Awaiting Advertisement': { inputs: [] },
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
    dr.date = bd ? shift(bd, dr.auOff || 0, dr.auUnit || 'months') : '';
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
export function ensureRuleRows(m: Mark, rules: RuleBook, allMarks?: Mark[]): void {
  if (!m) return;
  const list = rulesFor(rules, m.jurisdiction);
  const val = (n: string) => {
    const row = (m.dates || []).find((x) => x.name === n);
    return row && row.date;
  };
  const regPresent = val('Registration Date');
  list.forEach((r) => {
    if (!r.name || !r.trigger) return;
    const post = POST_REGISTRATION.test(r.name);
    const gateOk = post ? regPresent : val(r.trigger);
    if (!gateOk) return;
    ensureRow(m, r.name, { auBase: r.trigger, auOff: r.v, auUnit: r.u, auRem: Math.trunc(Number(r.rem)) || 0 });
  });
  // Two passes so rows whose base was itself just computed resolve in one call.
  auRecompute(m);
  auRecompute(m);
  if (allMarks) {
    linkDesignationRenewal(m, allMarks);
    allMarks.filter((x) => x.irId === m.id).forEach((des) => linkDesignationRenewal(des, allMarks));
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
  (cfg.inputs || []).forEach((n) => ensureRow(m, n, { auInput: true }));
  (cfg.activate || []).forEach((n) => {
    if (n === 'Convention Priority Deadline' && !['Australia', 'New Zealand'].includes(m.jurisdiction)) return;
    const r = ruleByName(rules, m.jurisdiction, n);
    if (r) ensureRow(m, n, { auBase: r.trigger, auOff: r.v, auUnit: r.u, auRem: Math.trunc(Number(r.rem)) || 0 });
  });
  if (cfg.activateTrigger) {
    rulesFor(rules, m.jurisdiction)
      .filter((r) => r.trigger === cfg.activateTrigger && r.name)
      .forEach((r) => ensureRow(m, r.name, { auBase: r.trigger, auOff: r.v, auUnit: r.u, auRem: Math.trunc(Number(r.rem)) || 0 }));
  }
  (cfg.extra || []).forEach((e) => ensureRow(m, e.name, { auBase: e.base, auOff: e.off, auUnit: e.unit, auRem: 0, auAlert: !!e.alert }));
  if (cfg.prompt) m.promptEmail = true;
  auRecompute(m);
}
