import { describe, expect, it } from 'vitest';
import { applyStage, ensureRuleRows, linkDesignationRenewal } from '../src/engine.js';
import { defaultRules, migrateRules, oppSchedule, RULES_VERSION } from '../src/rules.js';
import type { Mark, RuleBook } from '../src/types.js';

function blankMark(over: Partial<Mark> = {}): Mark {
  return {
    id: 'm1',
    name: 'TESTMARK',
    jurisdiction: 'Australia',
    application: '',
    registration: '',
    status: 'Pending',
    owner: '',
    filingBasis: '',
    type: 'Word',
    classes: '',
    regType: '',
    city: '',
    state: '',
    zip: '',
    country: 'Australia',
    phone: '',
    matter: '',
    ourDocket: '',
    clientDocket: '',
    goods: '',
    comments: '',
    disclaimers: '',
    dates: [],
    actions: [],
    contacts: [],
    docs: [],
    image: null,
    ...over,
  };
}

const rules: RuleBook = defaultRules();
const dateOf = (m: Mark, n: string) => m.dates.find((x) => x.name === n)?.date;

describe('Philippines DAU is a designation obligation, not an IR one', () => {
  it('a Madrid International Registration carries no Philippines dates', () => {
    const m = blankMark({ jurisdiction: 'Madrid Protocol (WIPO)' });
    m.dates.push({ name: 'Application Filed', date: '2020-01-01', done: true });
    ensureRuleRows(m, rules);
    expect(m.dates.some((d) => /philippines/i.test(d.name))).toBe(false);
  });
  it('a Philippines case carries the 3-year DAU from filing', () => {
    const m = blankMark({ jurisdiction: 'Philippines' });
    m.dates.push({ name: 'Application Filed', date: '2020-01-01', done: true });
    ensureRuleRows(m, rules);
    expect(dateOf(m, 'Philippines DAU deadline (3 years from filing)')).toBe('2023-01-01');
  });
});

describe('registered design renewal logic', () => {
  it('AU design renews at filing + 5 years with a 10-year maximum term', () => {
    const m = blankMark({ jurisdiction: 'Australia', type: 'Registered Design' });
    m.dates.push({ name: 'Application Filed', date: '2020-06-01', done: true });
    m.dates.push({ name: 'Registration Date', date: '2020-09-01', done: true });
    ensureRuleRows(m, rules);
    expect(dateOf(m, 'Renewal Deadline')).toBe('2025-06-01');
    expect(dateOf(m, 'Design Maximum Term Ends')).toBe('2030-06-01');
    // No trade-mark non-use row on a design.
    expect(m.dates.some((d) => /non-use/i.test(d.name))).toBe(false);
  });

  it('completing the AU design renewal does not roll past the 10-year max term', () => {
    const m = blankMark({ jurisdiction: 'Australia', type: 'Registered Design' });
    m.dates.push({ name: 'Application Filed', date: '2020-06-01', done: true });
    m.dates.push({ name: 'Registration Date', date: '2020-09-01', done: true });
    ensureRuleRows(m, rules);
    m.dates.find((d) => d.name === 'Renewal Deadline')!.done = true;
    ensureRuleRows(m, rules);
    const ren = m.dates.find((d) => d.name === 'Renewal Deadline')!;
    // Stays at the completed date (no roll to 2030), flagged final.
    expect(ren.date).toBe('2025-06-01');
    expect(ren.done).toBe(true);
    expect(ren.note).toMatch(/maximum registration term/i);
  });

  it('NZ design allows a second renewal (max term 15 years)', () => {
    const m = blankMark({ jurisdiction: 'New Zealand', type: 'Registered Design' });
    m.dates.push({ name: 'Application Filed', date: '2020-06-01', done: true });
    m.dates.push({ name: 'Registration Date', date: '2020-09-01', done: true });
    ensureRuleRows(m, rules);
    expect(dateOf(m, 'Design Maximum Term Ends')).toBe('2035-06-01');
    m.dates.find((d) => d.name === 'Renewal Deadline')!.done = true;
    ensureRuleRows(m, rules);
    // Rolls to the 10-year renewal (2030), still below the 15-year cap.
    expect(dateOf(m, 'Renewal Deadline')).toBe('2030-06-01');
  });
});

describe('opposition schedules', () => {
  it('AU standard opposition: NIO 2m, SGP +1m, NID +1m, evidence 3/3/2', () => {
    const s = oppSchedule('Australia')!;
    expect(s.steps.find((x) => /Intention to Defend/i.test(x.name))!.off).toBe(1);
    expect(s.steps.find((x) => /Intention to Oppose/i.test(x.name))!.off).toBe(2);
  });
  it('AU non-use removal uses its own anchor and roles', () => {
    const s = oppSchedule('Australia', 'Non-use removal')!;
    expect(s.anchor).toMatch(/non-use removal/i);
    expect(s.steps.find((x) => /Intention to Oppose \(removal\)/i.test(x.name))!.off).toBe(2);
    expect(s.steps.find((x) => /Intention to Defend \(removal\)/i.test(x.name))!.off).toBe(1);
  });
  it('South Korea opposition is 30 days from publication (2025 reform)', () => {
    const s = oppSchedule('South Korea')!;
    const opp = s.steps.find((x) => /Opposition due/i.test(x.name))!;
    expect(opp.off).toBe(30);
    expect(opp.unit).toBe('d');
  });
  it('verified jurisdictions are not flagged generic; unlisted ones fall back to a generic timeline', () => {
    expect(oppSchedule('Australia')!.verified).not.toBe(false);
    const generic = oppSchedule('France')!;
    expect(generic.verified).toBe(false);
    expect(generic.steps.length).toBeGreaterThan(0);
  });
});

describe('Mexico Declaration of Use', () => {
  it('deadline = Mexican registration + 3 years + 3 months', () => {
    const m = blankMark({ jurisdiction: 'Mexico', country: 'Mexico' });
    m.dates.push({ name: 'Registration Date', date: '2021-05-10', done: true });
    ensureRuleRows(m, rules);
    expect(dateOf(m, 'Mexico Declaration of Use window opens (3rd anniversary)')).toBe('2024-05-10');
    expect(dateOf(m, 'Mexico Declaration of Use deadline')).toBe('2024-08-10');
  });

  it('a Madrid designation of Mexico runs its DoU from its own grant date, not the IR date', () => {
    const ir = blankMark({ id: 'ir1', jurisdiction: 'Madrid Protocol (WIPO)' });
    ir.dates.push({ name: 'Application Filed', date: '2019-04-04', done: true });
    const des = blankMark({ id: 'des1', jurisdiction: 'Mexico', irId: 'ir1' });
    des.dates.push({ name: 'Application Filed', date: '2019-04-04', done: true });
    des.dates.push({ name: 'Registration Date', date: '2021-09-01', done: true }); // IMPI grant of protection
    const all = [ir, des];
    ensureRuleRows(ir, rules, all);
    ensureRuleRows(des, rules, all);
    // Anchored on the Mexican grant date (2021-09-01) → deadline 2024-12-01,
    // not the IR date (2019-04-04) which would give 2022-07-04.
    expect(dateOf(des, 'Mexico Declaration of Use deadline')).toBe('2024-12-01');
  });

  it('renewal DoU stays dormant until the WIPO renewal-notice recording date is entered, then runs +3 months', () => {
    const m = blankMark({ jurisdiction: 'Mexico', country: 'Mexico', irId: 'ir9' });
    m.dates.push({ name: 'Registration Date', date: '2015-01-10', done: true });
    ensureRuleRows(m, rules);
    const key = 'Mexico DoU (renewal) deadline — 3 months from IMPI recording of WIPO renewal notice';
    // No recording date yet → no deadline row.
    expect(m.dates.some((d) => d.name === key)).toBe(false);
    // Enter the date IMPI records the WIPO renewal notice → deadline = +3 months.
    m.dates.push({ name: 'WIPO renewal notice recorded by IMPI', date: '2025-02-01', done: true });
    ensureRuleRows(m, rules);
    expect(dateOf(m, key)).toBe('2025-05-01');
  });
});

describe('every alerting deadline gets an automatic 1-week reminder', () => {
  it('the AU acceptance deadline has a −1 week reminder', () => {
    const m = blankMark({ jurisdiction: 'Australia' });
    m.dates.push({ name: 'OA Issued', date: '2024-01-15', done: true });
    ensureRuleRows(m, rules);
    // Acceptance Deadline = OA Issued + 15 months = 2025-04-15; −1 week = 2025-04-08.
    expect(dateOf(m, 'Acceptance Deadline')).toBe('2025-04-15');
    expect(dateOf(m, 'Acceptance Deadline — 1 Week Reminder')).toBe('2025-04-08');
  });
});

describe('ensureRuleRows — the client-verified AU example', () => {
  it('entering the Registration Date on an AU case creates Renewal Deadline = Application Filed + 10 years', () => {
    const m = blankMark();
    m.dates.push({ name: 'Application Filed', date: '2020-08-15', done: true });
    m.dates.push({ name: 'Registration Date', date: '2021-02-10', done: true });
    ensureRuleRows(m, rules);
    expect(dateOf(m, 'Renewal Deadline')).toBe('2030-08-15');
    // Full AU reminder chain: −6m, −3m (Second), −1m (Final); grace +6m; and the
    // engine's automatic −1 week reminder on the deadline.
    expect(dateOf(m, 'Renewal Reminder')).toBe('2030-02-15');
    expect(dateOf(m, 'Renewal Reminder - Second')).toBe('2030-05-15');
    expect(dateOf(m, 'Renewal Reminder - Final')).toBe('2030-07-15');
    expect(dateOf(m, 'Renewal Deadline — 1 Week Reminder')).toBe('2030-08-08');
    expect(dateOf(m, '6 Month Renewal Grace Period')).toBe('2031-02-15');
    expect(dateOf(m, 'Non-use vulnerability date')).toBe('2024-02-10');
  });

  it('keeps the completed renewal as a ticked history row and opens the next one', () => {
    const m = blankMark();
    m.dates.push({ name: 'Application Filed', date: '2020-08-15', done: true });
    m.dates.push({ name: 'Registration Date', date: '2021-02-10', done: true });
    ensureRuleRows(m, rules);
    expect(dateOf(m, 'Renewal Deadline')).toBe('2030-08-15');
    // Tick the current renewal off, then re-run the engine.
    m.dates.find((d) => d.name === 'Renewal Deadline')!.done = true;
    ensureRuleRows(m, rules);
    // The completed renewal is preserved (old date, still ticked)…
    const done = m.dates.find((d) => d.name.startsWith('Renewal Deadline —') && d.name.includes('completed'))!;
    expect(done.date).toBe('2030-08-15');
    expect(done.done).toBe(true);
    // …and the active Renewal Deadline rolls to +10 years, reopened, with reminders.
    const ren = m.dates.find((d) => d.name === 'Renewal Deadline')!;
    expect(ren.date).toBe('2040-08-15');
    expect(ren.done).toBe(false);
    expect(dateOf(m, 'Renewal Reminder')).toBe('2040-02-15');
    expect(dateOf(m, '6 Month Renewal Grace Period')).toBe('2041-02-15');
    expect(m.dates.find((d) => d.name === 'Renewal Reminder')!.done).toBe(false);
  });

  it('auto-creates Convention Priority only for AU/NZ, never for a Madrid designation', () => {
    const au = blankMark();
    au.dates.push({ name: 'Application Filed', date: '2024-01-31', done: true });
    ensureRuleRows(au, rules);
    expect(dateOf(au, 'Convention Priority Deadline')).toBe('2024-07-31');

    // A designation (has irId) with the same filing date must not get one, and
    // an existing auto row is cleaned up.
    const des = blankMark({ jurisdiction: 'Japan', irId: 'ir-1' });
    des.dates.push({ name: 'Application Filed', date: '2024-01-31', done: true });
    des.dates.push({ name: 'Convention Priority Deadline', date: '2024-07-31', done: false, auBase: 'Application Filed' });
    ensureRuleRows(des, rules);
    expect(dateOf(des, 'Convention Priority Deadline')).toBeUndefined();
  });

  it('honours a pinned (imported) renewal date instead of recomputing it, and still makes reminders', () => {
    const m = blankMark();
    m.dates.push({ name: 'Application Filed', date: '2020-08-15', done: true });
    m.dates.push({ name: 'Registration Date', date: '2021-02-10', done: true });
    // An imported, non-standard renewal date, pinned.
    m.dates.push({ name: 'Renewal Deadline', date: '2031-06-30', done: false, pinned: true });
    ensureRuleRows(m, rules);
    expect(dateOf(m, 'Renewal Deadline')).toBe('2031-06-30'); // kept, not the computed 2030-08-15
    expect(dateOf(m, 'Renewal Reminder')).toBe('2030-12-30'); // reminders relative to the pinned date
  });

  it('does not create renewal rows before a Registration Date exists', () => {
    const m = blankMark();
    m.dates.push({ name: 'Application Filed', date: '2020-08-15', done: true });
    ensureRuleRows(m, rules);
    expect(dateOf(m, 'Renewal Deadline')).toBeUndefined();
    // But non-post-registration rules fire off their own trigger:
    expect(dateOf(m, 'Convention Priority Deadline')).toBe('2021-02-15');
  });

  it('AU Acceptance Deadline = 15 months from the first report (OA Issued)', () => {
    const m = blankMark();
    m.dates.push({ name: 'OA Issued', date: '2024-03-01', done: true });
    ensureRuleRows(m, rules);
    expect(dateOf(m, 'Acceptance Deadline')).toBe('2025-06-01');
  });

  it('US OA response due 6 months from issue; renewal runs from registration', () => {
    const m = blankMark({ jurisdiction: 'USA' });
    m.dates.push({ name: 'Application Filed', date: '2017-06-01', done: true });
    m.dates.push({ name: 'OA Issued', date: '2018-01-15', done: true });
    m.dates.push({ name: 'Registration Date', date: '2018-02-13', done: true });
    ensureRuleRows(m, rules);
    expect(dateOf(m, 'OA Response Due')).toBe('2018-07-15');
    expect(dateOf(m, 'Renewal Deadline')).toBe('2028-02-13');
    // §8 Declaration of Use falls in the 5th–6th year (6 years from registration).
    expect(dateOf(m, 'US Declaration of Use (5th-6th year)')).toBe('2024-02-13');
    // Engine adds an automatic 1-week reminder before the OA response deadline.
    expect(dateOf(m, 'OA Response Due — 1 Week Reminder')).toBe('2018-07-08');
  });

  it('AU opposition period runs 2 months from the advertisement/publication date', () => {
    const m = blankMark();
    m.dates.push({ name: 'Publication Date', date: '2024-05-20', done: true });
    ensureRuleRows(m, rules);
    expect(dateOf(m, 'Opposition period expires')).toBe('2024-07-20');
  });

  it('generates monthly countdown reminders for rules with rem set', () => {
    const m = blankMark();
    m.dates.push({ name: 'Application Filed', date: '2024-01-31', done: true });
    ensureRuleRows(m, rules);
    // Convention Priority Deadline = 2024-07-31, rem 3 → reminders at −3, −2, −1 months
    expect(dateOf(m, 'Convention Priority Deadline')).toBe('2024-07-31');
    expect(dateOf(m, 'Convention Priority Deadline — Reminder 1 of 3')).toBe('2024-04-30');
    expect(dateOf(m, 'Convention Priority Deadline — Reminder 2 of 3')).toBe('2024-05-31');
    expect(dateOf(m, 'Convention Priority Deadline — Reminder 3 of 3')).toBe('2024-06-30');
  });

  it('is idempotent and recomputes when a base date changes', () => {
    const m = blankMark();
    m.dates.push({ name: 'Application Filed', date: '2020-08-15', done: true });
    m.dates.push({ name: 'Registration Date', date: '2021-02-10', done: true });
    ensureRuleRows(m, rules);
    const count = m.dates.length;
    ensureRuleRows(m, rules);
    expect(m.dates.length).toBe(count);
    m.dates.find((x) => x.name === 'Application Filed')!.date = '2020-09-01';
    ensureRuleRows(m, rules);
    expect(dateOf(m, 'Renewal Deadline')).toBe('2030-09-01');
  });
});

describe('applyStage — status engine', () => {
  it('Pending seeds the Application Filed input row', () => {
    const m = blankMark();
    applyStage(m, rules, 'Pending');
    const row = m.dates.find((x) => x.name === 'Application Filed');
    expect(row).toBeDefined();
    expect(row!.auInput).toBe(true);
  });

  it('Registered activates the full renewal chain off the Registration Date trigger', () => {
    const m = blankMark();
    m.dates.push({ name: 'Application Filed', date: '2020-08-15', done: true });
    applyStage(m, rules, 'Registered');
    expect(m.dates.some((x) => x.name === 'Registration Date' && x.auInput)).toBe(true);
    // Renewal Deadline row activated (AU: anchored to Application Filed)
    expect(dateOf(m, 'Renewal Deadline')).toBe('2030-08-15');
    // Non-use rule triggers off Registration Date, which is still empty
    expect(dateOf(m, 'Non-use vulnerability date')).toBe('');
  });

  it('Convention Priority auto-activation is limited to AU/NZ', () => {
    const us = blankMark({ jurisdiction: 'USA' });
    applyStage(us, rules, 'Pending - Awaiting Examination');
    expect(us.dates.some((x) => x.name === 'Convention Priority Deadline')).toBe(false);
    const au = blankMark();
    applyStage(au, rules, 'Pending - Awaiting Examination');
    expect(au.dates.some((x) => x.name === 'Convention Priority Deadline')).toBe(true);
  });
});

describe('Madrid International Registration renewal', () => {
  it('computes the IR renewal from its filing date, without a registration date', () => {
    const ir = blankMark({ id: 'ir1', jurisdiction: 'Madrid Protocol (WIPO)' });
    ir.dates.push({ name: 'Application Filed', date: '2014-04-04', done: true });
    ensureRuleRows(ir, rules);
    // Renewal = IR filing date + 10 years; dependency = filing + 5 years.
    expect(dateOf(ir, 'Renewal Deadline')).toBe('2024-04-04');
    expect(dateOf(ir, 'Dependency Period Ends')).toBe('2019-04-04');
  });

  it('a non-Madrid jurisdiction still gates renewal behind a registration date', () => {
    const us = blankMark({ jurisdiction: 'USA' });
    us.dates.push({ name: 'Application Filed', date: '2014-04-04', done: true });
    ensureRuleRows(us, rules);
    expect(dateOf(us, 'Renewal Deadline')).toBeUndefined();
  });
});

describe('Madrid designation renewal linkage', () => {
  it('designation copies the IR renewal instead of computing its own, and re-propagates', () => {
    const ir = blankMark({ id: 'ir1', jurisdiction: 'Madrid Protocol (WIPO)' });
    ir.dates.push({ name: 'Application Filed', date: '2014-04-04', done: true });
    ir.dates.push({ name: 'Registration Date', date: '2014-04-04', done: true });
    const des = blankMark({ id: 'des1', jurisdiction: 'Japan', irId: 'ir1' });
    des.dates.push({ name: 'Application Filed', date: '2014-04-04', done: true });
    const all = [ir, des];
    ensureRuleRows(ir, rules, all);
    // Madrid renewal: 10 years from IR date
    expect(dateOf(ir, 'Renewal Deadline')).toBe('2024-04-04');
    expect(dateOf(ir, 'Dependency Period Ends')).toBe('2019-04-04');
    const dRen = des.dates.find((x) => x.name === 'Renewal Deadline');
    expect(dRen?.date).toBe('2024-04-04');
    expect(dRen?.linkedToIR).toBe(true);
    expect(dateOf(des, 'Renewal Reminder')).toBe('2023-10-04');
    expect(dateOf(des, '6 Month Renewal Grace Period')).toBe('2024-10-04');
    // Change the IR's renewal → propagates to the designation
    ir.dates.find((x) => x.name === 'Renewal Deadline')!.date = '2034-04-04';
    linkDesignationRenewal(des, all);
    expect(dateOf(des, 'Renewal Deadline')).toBe('2034-04-04');
    expect(dateOf(des, 'Renewal Reminder - 1 Week')).toBe('2034-03-28');
  });
});

describe('rulesVersion migration', () => {
  it('replaces built-in rules but preserves custom rules', () => {
    const stored: RuleBook = {
      _default: [{ name: 'Old builtin', trigger: 'X', v: 1, u: 'months', alerts: false, template: '' }],
      Australia: [
        { name: 'Stale rule', trigger: 'X', v: 1, u: 'months', alerts: false, template: '' },
        { name: 'My custom rule', trigger: 'Application Filed', v: 4, u: 'months', alerts: true, template: '', custom: true },
      ],
    };
    const { rules: migrated, rulesVersion } = migrateRules(stored, 3);
    expect(rulesVersion).toBe(RULES_VERSION);
    expect(migrated.Australia.some((r) => r.name === 'Stale rule')).toBe(false);
    expect(migrated.Australia.some((r) => r.name === 'My custom rule')).toBe(true);
    expect(migrated.Australia.some((r) => r.name === 'Acceptance Deadline')).toBe(true);
    expect(migrated._default.some((r) => r.name === 'Old builtin')).toBe(false);
  });

  it('is a no-op at the current version', () => {
    const stored: RuleBook = { _default: [], Australia: [] };
    const { rules: same } = migrateRules(stored, RULES_VERSION);
    expect(same).toBe(stored);
  });
});
