import { useState } from 'react';
import { Field } from './ui';
import { copyEmailToClipboard, type ComposedEmail } from './email';

/**
 * Shared email compose/preview modal used from both a case and the Alerts
 * screen. Shows the rendered HTML email, copies it as rich HTML for pasting
 * into a mail client, and offers a plain-text mailto fallback.
 */
export function EmailComposeModal({ email, title, hasLogo, onClose }: {
  email: ComposedEmail;
  title: string;
  hasLogo?: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(22,35,59,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '40px 16px', overflowY: 'auto' }}
      onClick={onClose}
    >
      <div className="card" style={{ maxWidth: 680, width: '100%', margin: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <div className="section-label" style={{ marginBottom: 0 }}>✉ Email — {title}</div>
          <button className="btn danger-link" onClick={onClose}>✕</button>
        </div>
        <div className="hint" style={{ marginBottom: 10 }}>
          This is a formatted HTML email with your sign-off{hasLogo ? ' and the case logo' : ''}. Copy it and paste into Outlook — the formatting{hasLogo ? ', logo' : ''} and signature come across. “Open in email app” sends a plain-text version instead.
        </div>
        <Field label="To"><input type="text" value={email.to} readOnly /></Field>
        <Field label="Subject"><input type="text" value={email.subject} readOnly /></Field>
        <div className="section-label" style={{ marginTop: 8 }}>Preview</div>
        <div
          style={{ background: '#fff', color: '#16233b', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', maxHeight: 340, overflowY: 'auto', fontSize: 13, lineHeight: 1.5 }}
          dangerouslySetInnerHTML={{ __html: email.html }}
        />
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <button
            className="btn secondary"
            onClick={() => window.open(`mailto:${encodeURIComponent(email.to)}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.plain)}`)}
            title="Opens your mail app with the text version (no logo)"
          >
            Open in email app
          </button>
          <button className="btn" onClick={async () => setCopied(await copyEmailToClipboard(email))}>
            {copied ? '✓ Copied — paste into your email' : 'Copy HTML email'}
          </button>
        </div>
      </div>
    </div>
  );
}
