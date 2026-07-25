import net from 'node:net';
import tls from 'node:tls';

/**
 * Minimal SMTP client, kept dependency-free so the deploy bundle still installs
 * nothing on the host. Designed for a standard cPanel/VentraIP mail account:
 * implicit TLS on 465, or STARTTLS on 587, with AUTH LOGIN.
 *
 * Configured entirely from environment variables (set in the cPanel Node app
 * panel, alongside SESSION_SECRET) — no credentials in the database or code:
 *   SMTP_HOST     mail server host, e.g. mail.brandu.legal
 *   SMTP_PORT     465 (SSL) or 587 (STARTTLS); default 587
 *   SMTP_USER     full mailbox address, e.g. alerts@brandu.legal
 *   SMTP_PASS     mailbox password
 *   SMTP_FROM     From address (defaults to SMTP_USER)
 *   SMTP_SECURE   '1' to force implicit TLS (auto-on for port 465)
 */

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
}

export function smtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const from = process.env.SMTP_FROM?.trim() || user;
  const secure = process.env.SMTP_SECURE ? /^(1|true|yes)$/i.test(process.env.SMTP_SECURE) : port === 465;
  return { host, port, user, pass, from, secure };
}

export function mailerConfigured(): boolean {
  return !!smtpConfig();
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const CRLF = '\r\n';

/** Encode a header value as a MIME encoded-word when it isn't plain ASCII. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildMime(cfg: SmtpConfig, msg: MailMessage): string {
  const boundary = `bnd_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  const text = (msg.text || htmlToText(msg.html) || '').replace(/\r?\n/g, CRLF);
  const html = msg.html.replace(/\r?\n/g, CRLF);
  const headers = [
    `From: ${cfg.from}`,
    `To: ${msg.to}`,
    `Subject: ${encodeHeader(msg.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${cfg.host}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join(CRLF);
  const body = [
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    `--${boundary}--`,
    '',
  ].join(CRLF);
  // Dot-stuff lines that begin with '.' so DATA isn't terminated early.
  return (headers + CRLF + body).replace(/\r\n\./g, `${CRLF}..`);
}

/** Run one SMTP conversation and send a single message. */
export function sendMail(msg: MailMessage): Promise<void> {
  const cfg = smtpConfig();
  if (!cfg) return Promise.reject(new Error('SMTP is not configured'));

  return new Promise<void>((resolve, reject) => {
    let socket: net.Socket | tls.TLSSocket;
    let buf = '';
    let done = false;
    const queue: { code: number; send?: string; then: () => void }[] = [];

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch { /* ignore */ }
      err ? reject(err) : resolve();
    };

    const timer = setTimeout(() => finish(new Error('SMTP timeout')), 20000);
    const cleanupResolve = () => { clearTimeout(timer); finish(); };
    const cleanupReject = (e: Error) => { clearTimeout(timer); finish(e); };

    // Handshake step index: 0 greeting, 1 after EHLO, 2 after STARTTLS, 3 EHLO-over-TLS.
    let step = 0;
    const write = (line: string) => socket.write(line + CRLF);

    const onResponse = (code: number, text: string) => {
      // Basic linear handshake with an inline AUTH LOGIN sub-exchange.
      if (authPhase > 0) {
        if (authPhase === 1) {
          if (code !== 334) return cleanupReject(new Error(`AUTH rejected: ${code} ${text}`));
          socket.write(Buffer.from(cfg.user, 'utf8').toString('base64') + CRLF);
          authPhase = 2;
          return;
        }
        if (authPhase === 2) {
          if (code !== 334) return cleanupReject(new Error(`AUTH rejected: ${code} ${text}`));
          socket.write(Buffer.from(cfg.pass, 'utf8').toString('base64') + CRLF);
          authPhase = 3;
          return;
        }
        if (authPhase === 3) {
          if (code !== 235) return cleanupReject(new Error(`Login failed: ${code} ${text}`));
          authPhase = 0;
          write(`MAIL FROM:<${cfg.from}>`);
          mailPhase = 1;
          return;
        }
      }
      if (mailPhase > 0) {
        if (mailPhase === 1) {
          if (code !== 250) return cleanupReject(new Error(`MAIL FROM failed: ${code} ${text}`));
          write(`RCPT TO:<${msg.to}>`);
          mailPhase = 2;
          return;
        }
        if (mailPhase === 2) {
          if (code !== 250 && code !== 251) return cleanupReject(new Error(`RCPT TO failed: ${code} ${text}`));
          write('DATA');
          mailPhase = 3;
          return;
        }
        if (mailPhase === 3) {
          if (code !== 354) return cleanupReject(new Error(`DATA failed: ${code} ${text}`));
          socket.write(buildMime(cfg, msg) + CRLF + '.' + CRLF);
          mailPhase = 4;
          return;
        }
        if (mailPhase === 4) {
          if (code !== 250) return cleanupReject(new Error(`Message rejected: ${code} ${text}`));
          write('QUIT');
          return cleanupResolve();
        }
      }
      // Handshake phase (greeting → EHLO → STARTTLS/AUTH).
      if (step === 0) {
        if (code !== 220) return cleanupReject(new Error(`Unexpected greeting: ${code} ${text}`));
        step = 1;
        write(`EHLO ${cfg.host}`);
        return;
      }
      if (step === 1) {
        if (code !== 250) return cleanupReject(new Error(`EHLO failed: ${code} ${text}`));
        if (!cfg.secure && /STARTTLS/i.test(text)) {
          step = 2;
          write('STARTTLS');
          return;
        }
        startAuth();
        return;
      }
      if (step === 2) {
        if (code !== 220) return cleanupReject(new Error(`STARTTLS failed: ${code} ${text}`));
        upgradeTls();
        return;
      }
      if (step === 3) {
        // EHLO after STARTTLS
        if (code !== 250) return cleanupReject(new Error(`EHLO (TLS) failed: ${code} ${text}`));
        startAuth();
        return;
      }
    };

    let authPhase = 0;
    let mailPhase = 0;
    const startAuth = () => {
      authPhase = 1;
      write('AUTH LOGIN');
    };

    const upgradeTls = () => {
      const plain = socket;
      const secure = tls.connect({ socket: plain, servername: cfg.host }, () => {
        step = 3;
        write(`EHLO ${cfg.host}`);
      });
      secure.on('data', onData);
      secure.on('error', (e) => cleanupReject(e));
      socket = secure;
    };

    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let idx: number;
      // Process each complete line; a final response line is "NNN " (space).
      while ((idx = buf.indexOf(CRLF)) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const m = /^(\d{3})([ -])(.*)$/.exec(line);
        if (!m) continue;
        if (m[2] === '-') continue; // multiline continuation
        onResponse(parseInt(m[1], 10), m[3]);
      }
    };

    const connectOpts = { host: cfg.host, port: cfg.port };
    socket = cfg.secure
      ? tls.connect({ ...connectOpts, servername: cfg.host }, () => undefined)
      : net.connect(connectOpts);
    socket.on('data', onData);
    socket.on('error', (e) => cleanupReject(e as Error));
    socket.on('close', () => { if (!done) cleanupReject(new Error('Connection closed unexpectedly')); });
  });
}
