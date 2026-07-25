/**
 * Canonical CSV columns for bulk case import, shared by the server (mapping) and
 * the client (template download + reference). One row per case.
 */
export const IMPORT_COLUMNS: string[] = [
  'MarkName', 'Jurisdiction', 'Type', 'Status', 'ApplicationNo', 'RegistrationNo', 'IRNo',
  'Classes', 'GoodsServices', 'OurRef', 'ClientRef',
  'OwnerName', 'OwnerACN', 'OwnerABN', 'OwnerAddress', 'OwnerCity', 'OwnerState', 'OwnerPostcode', 'OwnerCountry',
  'ClientContactName', 'ClientContactEmail',
  'FiledDate', 'PriorityDate', 'RegistrationDate', 'PublicationDate', 'OAIssuedDate', 'RenewalDate',
  'Comments',
];

/** A worked example row (aligned to IMPORT_COLUMNS) for the downloadable template. */
export const IMPORT_EXAMPLE_ROW: string[] = [
  'BRANDU', 'Australia', 'Word', 'Registered', '2345678', '2345678', '',
  '9, 42', 'Class 9: Downloadable software; Class 42: Legal services', 'TM-1001', 'CLIENT-7',
  'BrandU Pty Ltd', '600 123 456', '12 600 123 456', '1 Legal St', 'Sydney', 'NSW', '2000', 'Australia',
  'Jane Client', 'jane@example.com',
  '15/08/2020', '', '10/02/2021', '', '', '',
  'Imported from legacy system',
];

/** Short human notes on how each column is used, for the reference panel. */
export const IMPORT_COLUMN_NOTES: Record<string, string> = {
  MarkName: 'Required. The trade mark name/word.',
  Jurisdiction: 'e.g. Australia, New Zealand, USA. Defaults to Australia.',
  Type: 'Word, Logo, Combined, Series, 3D Shape, Sound, Colour. Defaults to Word.',
  Status: 'e.g. Registered, Pending, Accepted, Opposed, Lapsed. Inferred if blank.',
  ApplicationNo: 'Application number.',
  RegistrationNo: 'Registration number (in AU usually the same as the application).',
  IRNo: 'International Registration number, for a Madrid designation.',
  Classes: 'Nice classes, e.g. "9, 42".',
  GoodsServices: 'Goods/services text (a single cell — wrap in quotes if it contains commas).',
  OurRef: 'Your file/matter reference.',
  ClientRef: 'The client’s own reference.',
  OwnerName: 'Registered owner / applicant name.',
  OwnerACN: 'Owner ACN / ARBN.',
  OwnerABN: 'Owner ABN.',
  OwnerAddress: 'Owner street address (one line).',
  OwnerCity: 'Owner suburb/city.',
  OwnerState: 'Owner state.',
  OwnerPostcode: 'Owner postcode.',
  OwnerCountry: 'Owner country. Defaults to Australia.',
  ClientContactName: 'Primary client contact name (added to the case contacts).',
  ClientContactEmail: 'Primary client contact email (used for client emails).',
  FiledDate: 'Application filing date (dd/mm/yyyy).',
  PriorityDate: 'Convention priority date, if any.',
  RegistrationDate: 'Registration date — this drives the renewal calculation.',
  PublicationDate: 'Acceptance/advertised date, if known.',
  OAIssuedDate: 'Date the first examination/adverse report issued, if any.',
  RenewalDate: 'Optional. If given, used exactly; otherwise the system calculates it.',
  Comments: 'Free-text notes.',
};
