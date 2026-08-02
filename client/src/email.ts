import { mergeTemplate, mergeTemplateHtml, stripInlineFormat, rulesFor, type EmailTemplate, type FirmSettings, type Mark, type RuleBook } from '@brandu/shared';

export interface ComposedEmail {
  to: string;
  subject: string;
  html: string;
  plain: string;
}

/** Fetch an image behind the app's auth and turn it into a data: URI. */
export async function toDataUri(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === 'string' ? r.result : undefined);
      r.onerror = () => resolve(undefined);
      r.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

/** Convert an HTML signature to plain text (fallback for the mailto version). */
export function htmlToText(html: string): string {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.innerText || d.textContent || '').trim();
}

/** Escape plain text and turn newlines into <br> for the HTML version. */
export function textToHtml(t: string): string {
  return t.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('\n').join('<br>');
}

/** Find the email template (or date-rule template) that applies to a deadline. */
export function templateForDate(
  m: Mark,
  dateName: string,
  emailFor: string | undefined,
  templates: EmailTemplate[],
  rules: RuleBook
): { subject?: string; body: string } | null {
  const dfName = emailFor || dateName;
  const tpl =
    templates.find((t) => t.dateField === dfName && t.jurisdiction === m.jurisdiction) ||
    templates.find((t) => t.dateField === dfName);
  if (tpl) return { subject: tpl.subject, body: tpl.body };
  const rule = rulesFor(rules, m.jurisdiction).find((r) => (r.name === dateName || (emailFor && r.name === emailFor)) && r.template);
  if (rule) return { body: rule.template! };
  return null;
}

/**
 * Build the HTML + plain-text email for a case deadline, using the sender's
 * own sign-off (falling back to the firm default) and inlining the case graphic.
 */
export async function buildDeadlineEmail(opts: {
  mark: Mark;
  dateName: string;
  emailFor?: string;
  date: string;
  templates: EmailTemplate[];
  rules: RuleBook;
  firm: FirmSettings | null;
  mySignature: string;
}): Promise<ComposedEmail | null> {
  const { mark: m, dateName, emailFor, date, templates, rules, firm, mySignature } = opts;
  const found = templateForDate(m, dateName, emailFor, templates, rules);
  if (!found) return null;

  const client = (m.contacts || []).find((c) => (c.position || '').toLowerCase() === 'client');
  const to = client?.email || '';
  const hasMine = !!(mySignature && mySignature.replace(/<[^>]*>/g, '').trim());
  const signatureHtml = hasMine ? mySignature : textToHtml(firm?.emailSignature || '');
  const signature = hasMine ? htmlToText(mySignature) : firm?.emailSignature || '';
  const ctx = { dueDate: date, firmName: firm?.lawFirmName, signature, signatureHtml };

  // Subjects are always plain, and the plain-text body drops the **/__ markers
  // (they only mean anything in the HTML version).
  const subject = stripInlineFormat(found.subject ? mergeTemplate(found.subject, m, ctx) : `Re: ${m.name} - ${dateName}`);
  const plain = stripInlineFormat(mergeTemplate(found.body, m, ctx));
  const markImage = m.image ? await toDataUri(m.image) : undefined;
  const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#16233b;line-height:1.5">${mergeTemplateHtml(found.body, m, { ...ctx, markImage })}</div>`;
  return { to, subject, html, plain };
}

/** Copy an email to the clipboard as rich HTML (with a plain-text alternative). */
export async function copyEmailToClipboard(email: ComposedEmail): Promise<boolean> {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([email.html], { type: 'text/html' }),
        'text/plain': new Blob([email.plain], { type: 'text/plain' }),
      }),
    ]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(email.plain);
      return true;
    } catch {
      return false;
    }
  }
}
