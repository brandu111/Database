import type { Mark, MarkDate } from '@brandu/shared';

/**
 * IP Australia — Australian Trade Mark Search API integration.
 *
 * Auth is OAuth2 client-credentials: exchange the firm's client id/secret for a
 * short-lived access token, then call `GET /trade-mark/{ipRightIdentifier}` with
 * a Bearer token. Credentials live only in server environment variables and are
 * never sent to the browser.
 *
 * Configure via:
 *   IPAU_CLIENT_ID       OAuth2 client id     (from the IP Australia dev portal)
 *   IPAU_CLIENT_SECRET   OAuth2 client secret
 *   IPAU_ENV             "test" (default) or "production"
 */

const ENVS = {
  test: {
    token: 'https://test.api.ipaustralia.gov.au/public/external-token-api/v1/access_token',
    base: 'https://test.api.ipaustralia.gov.au/public/australian-trade-mark-search-api/v1',
  },
  production: {
    token: 'https://production.api.ipaustralia.gov.au/public/external-token-api/v1/access_token',
    base: 'https://production.api.ipaustralia.gov.au/public/australian-trade-mark-search-api/v1',
  },
} as const;

export function ipAuConfigured(): boolean {
  return !!(process.env.IPAU_CLIENT_ID && process.env.IPAU_CLIENT_SECRET);
}

function endpoints() {
  const env = (process.env.IPAU_ENV || 'test').toLowerCase() === 'production' ? 'production' : 'test';
  return ENVS[env];
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;
  const { token } = endpoints();
  // IP Australia's token endpoint authenticates the client with HTTP Basic
  // (client id/secret in the Authorization header); the body carries only the
  // grant type. Sending the secret in the body is rejected as invalid_request.
  const basic = Buffer.from(`${process.env.IPAU_CLIENT_ID}:${process.env.IPAU_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new IpAuError(res.status === 401 || res.status === 403 ? 401 : 502, `IP Australia auth failed (${res.status}). Check IPAU_CLIENT_ID / IPAU_CLIENT_SECRET. ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new IpAuError(502, 'IP Australia auth returned no access token');
  cachedToken = { value: json.access_token, expiresAt: now + (json.expires_in ? json.expires_in * 1000 : 3600_000) };
  return cachedToken.value;
}

export class IpAuError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Raw ApiTrademark, loosely typed — every field is nullable in the spec. */
interface ApiTrademark {
  number?: string | null;
  words?: (string | null)[] | null;
  kind?: (string | null)[] | null;
  markCategories?: (string | null)[] | null;
  goodsAndServices?: ({ class?: string | null; classNumber?: string | number | null; niceClass?: string | number | null; descriptionText?: string | null } | null)[] | null;
  /** Some responses carry the Nice classes at the top level instead. */
  classes?: (string | number | null)[] | null;
  classNumbers?: (string | number | null)[] | null;
  niceClasses?: (string | number | null)[] | null;
  owner?: (ApiPartyType | null)[] | null;
  filingDate?: string | null;
  priorityDate?: string | null;
  firstReportDate?: string | null;
  acceptanceDate?: string | null;
  acceptanceAdvertisedDate?: string | null;
  registrationAdvertisedDate?: string | null;
  enteredOnRegisterDate?: string | null;
  registeredFromDate?: string | null;
  renewalDueDate?: string | null;
  lapsedDate?: string | null;
  statusDetail?: string | null;
  statusGroup?: string | null;
  irNumber?: string | null;
  images?: { description?: (string | null)[] | null; images?: (string | null)[] | null } | null;
}

interface ApiPartyType {
  name?: string | null;
  abn?: string | null;
  acnOrArbn?: string | null;
  jurisdiction?: string | null;
  structuredAddress?: {
    addressLineText?: string | null;
    suburb?: string | null;
    state?: string | null;
    postalCode?: string | null;
    countryName?: string | null;
  } | null;
}

const clean = (s: string | null | undefined): string => (s == null ? '' : String(s).trim());
const isoDate = (s: string | null | undefined): string => {
  const v = clean(s);
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '';
};

/** Map a status from the register onto the app's workflow statuses (best-effort). */
function mapStatus(tm: ApiTrademark): string {
  const s = `${clean(tm.statusGroup)} ${clean(tm.statusDetail)}`.toLowerCase();
  if (s.includes('registered') || s.includes('protected')) return 'Registered';
  if (s.includes('removed') || s.includes('expired') || s.includes('lapsed') || s.includes('ceased')) return 'Lapsed';
  if (s.includes('withdrawn')) return 'Withdrawn';
  if (s.includes('accepted')) return 'Accepted';
  if (s.includes('opposed')) return 'Opposed';
  if (s.includes('examination') || s.includes('under exam')) return 'Pending - Under Examination';
  if (s.includes('pending') || s.includes('filed') || s.includes('lodged')) return 'Pending';
  return clean(tm.statusDetail) || clean(tm.statusGroup) || 'Pending';
}

/** Best-effort mark type from the register's kind / categories, and whether an image exists. */
/** The register's logo/device image URL (largest available), if any. */
function imageUrlOf(tm: ApiTrademark): string {
  const imgs = (tm.images?.images || []).map(clean).filter(Boolean);
  return imgs.find((u) => /HIGH|LARGE/i.test(u)) || imgs.find((u) => /MEDIUM/i.test(u)) || imgs[0] || '';
}

function mapType(tm: ApiTrademark): string {
  const tokens = [...(tm.kind || []), ...(tm.markCategories || [])].map((x) => clean(x).toLowerCase());
  const hasImage = !!imageUrlOf(tm);
  const hasWord = tokens.some((t) => t.includes('word'));
  const hasDevice = tokens.some((t) => t.includes('device') || t.includes('figurative') || t.includes('logo') || t.includes('fancy'));
  if (tokens.some((t) => t.includes('series'))) return 'Series';
  if (tokens.some((t) => t.includes('sound'))) return 'Sound';
  if (tokens.some((t) => t.includes('shape') || t.includes('3d'))) return '3D Shape';
  if (tokens.some((t) => t.includes('colour') || t.includes('color'))) return 'Colour';
  if (hasWord && (hasDevice || hasImage)) return 'Combined';
  if (hasDevice || hasImage) return 'Logo';
  return 'Word';
}

/**
 * Convert an ApiTrademark record into the subset of Mark fields this app stores.
 * Pure and side-effect free — unit-tested against a sample response.
 */
export function mapApiTrademark(tm: ApiTrademark): Partial<Mark> {
  const words = (tm.words || []).map(clean).filter(Boolean);
  const name = words.join('; ');
  const gs = (tm.goodsAndServices || []).filter(Boolean) as {
    class?: string | null;
    classNumber?: string | number | null;
    niceClass?: string | number | null;
    descriptionText?: string | null;
  }[];
  // The Nice class can arrive under a few different keys depending on the API
  // version — check each so the Classes box is always populated when present.
  const classOf = (g: { class?: string | null; classNumber?: string | number | null; niceClass?: string | number | null }): string =>
    clean(g.class) || clean(g.classNumber as string) || clean(g.niceClass as string);
  const classSet = new Set<string>();
  gs.forEach((g) => {
    const c = classOf(g);
    if (c) c.split(/[,;/]/).forEach((p) => { const v = clean(p); if (v) classSet.add(v); });
  });
  // Fall back to any top-level class list the response provides.
  [...(tm.classes || []), ...(tm.classNumbers || []), ...(tm.niceClasses || [])].forEach((c) => {
    const v = clean(c as string);
    if (v) v.split(/[,;/]/).forEach((p) => { const q = clean(p); if (q) classSet.add(q); });
  });
  const classes = [...classSet]
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b))
    .join(', ');
  const goods = gs
    .map((g) => (classOf(g) ? `Class ${classOf(g)}: ${clean(g.descriptionText)}` : clean(g.descriptionText)))
    .filter(Boolean)
    .join('\n');

  const owner = (tm.owner || []).find(Boolean) || null;
  const addr = owner?.structuredAddress || null;

  const dates: MarkDate[] = [];
  const addDate = (label: string, iso: string) => {
    if (iso) dates.push({ name: label, date: iso, done: true });
  };
  addDate('Application Filed', isoDate(tm.filingDate));
  addDate('Priority Date', isoDate(tm.priorityDate));
  addDate('OA Issued', isoDate(tm.firstReportDate));
  addDate('Publication Date', isoDate(tm.acceptanceAdvertisedDate) || isoDate(tm.registrationAdvertisedDate));
  addDate('Registration Date', isoDate(tm.enteredOnRegisterDate) || isoDate(tm.registeredFromDate));

  const image = imageUrlOf(tm) || null;
  const number = clean(tm.number);
  const registered = !!(isoDate(tm.enteredOnRegisterDate) || isoDate(tm.registeredFromDate));

  const out: Partial<Mark> = {
    name,
    wordText: name,
    type: mapType(tm),
    application: number,
    // In Australia the trade mark number serves as both the application and the
    // registration number, so populate the registration field once registered.
    registration: registered ? number : '',
    classes,
    goods,
    status: mapStatus(tm),
    jurisdiction: 'Australia',
    dates,
  };
  if (image) out.image = image;
  if (tm.irNumber) {
    out.irNumber = clean(tm.irNumber);
    out.filingBasis = 'Madrid Protocol';
  }
  if (owner) {
    out.owner = clean(owner.name);
    out.ownerType = owner.abn || owner.acnOrArbn ? 'Company' : 'Individual';
    out.ownerAbn = clean(owner.abn);
    out.ownerAcn = clean(owner.acnOrArbn);
    if (addr) {
      out.address1 = clean(addr.addressLineText);
      out.city = clean(addr.suburb);
      out.state = clean(addr.state);
      out.zip = clean(addr.postalCode);
      out.country = clean(addr.countryName) || 'Australia';
    }
  }
  return out;
}

/** Saves image bytes somewhere durable and returns a URL the client can load. */
export type SaveImage = (buffer: Buffer, contentType: string, sourceUrl: string) => Promise<string> | string;

/**
 * Look up a trade mark by its number and return the mapped Mark fields. When a
 * `saveImage` sink is provided and the register has a logo/device image, the
 * image is downloaded from IP Australia's public image CDN and stored locally,
 * so the mark's `image` becomes a durable local URL rather than a hotlink.
 */
export async function lookupTradeMark(numberRaw: string, opts: { saveImage?: SaveImage } = {}): Promise<Partial<Mark>> {
  if (!ipAuConfigured()) {
    throw new IpAuError(503, 'IP Australia lookup is not configured on the server (set IPAU_CLIENT_ID and IPAU_CLIENT_SECRET).');
  }
  const num = clean(numberRaw).replace(/\s+/g, '');
  if (!num) throw new IpAuError(400, 'Enter an application or registration number to look up.');
  const token = await getAccessToken();
  const { base } = endpoints();
  const res = await fetch(`${base}/trade-mark/${encodeURIComponent(num)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (res.status === 404) throw new IpAuError(404, `No trade mark found on the IP Australia register for "${num}".`);
  if (res.status === 401 || res.status === 403) {
    cachedToken = null;
    throw new IpAuError(401, 'IP Australia rejected the request (token/credentials). Please check the API credentials.');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new IpAuError(502, `IP Australia lookup failed (${res.status}). ${text.slice(0, 200)}`);
  }
  const tm = (await res.json()) as ApiTrademark;
  const fields = mapApiTrademark(tm);

  // Download and store the logo. The image CDN is public, so we deliberately do
  // NOT send the API token to it. Best-effort: on any failure keep the fields
  // (minus the image) rather than failing the whole lookup.
  if (fields.image && opts.saveImage) {
    try {
      const imgRes = await fetch(fields.image, { headers: { Accept: 'image/*' } });
      if (imgRes.ok) {
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        fields.image = await opts.saveImage(buffer, contentType, fields.image);
      } else {
        delete fields.image;
      }
    } catch {
      delete fields.image;
    }
  }
  return fields;
}
