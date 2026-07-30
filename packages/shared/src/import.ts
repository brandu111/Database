/**
 * Canonical CSV columns for bulk case import, shared by the server (mapping) and
 * the client (template download + reference). One row per case.
 */
export const IMPORT_COLUMNS: string[] = [
  'MarkName', 'Jurisdiction', 'Type', 'Status', 'ApplicationNo', 'RegistrationNo', 'IRNo',
  'Classes', 'GoodsServices', 'OurRef', 'ClientRef',
  'ResponsibleAttorney', 'Associate', 'AssociateRef', 'Tags', 'RenewalFee',
  'OwnerName', 'OwnerACN', 'OwnerABN', 'OwnerAddress', 'OwnerCity', 'OwnerState', 'OwnerPostcode', 'OwnerCountry',
  'ClientContactName', 'ClientContactEmail',
  'FiledDate', 'PriorityDate', 'RegistrationDate', 'PublicationDate', 'OAIssuedDate', 'RenewalDate',
  'Comments',
];

/** A worked example row (aligned to IMPORT_COLUMNS) for the downloadable template. */
export const IMPORT_EXAMPLE_ROW: string[] = [
  'BRANDU', 'Australia', 'Word', 'Registered', '2345678', '2345678', '',
  '9, 42', 'Class 9: Downloadable software; Class 42: Legal services', 'TM-1001', 'CLIENT-7',
  'Natalie Brandu', 'Smith IP (NZ)', 'SIP-9910', 'key brand; watch', '450',
  'BrandU Pty Ltd', '600 123 456', '12 600 123 456', '1 Legal St', 'Sydney', 'NSW', '2000', 'Australia',
  'Jane Client', 'jane@example.com',
  '15/08/2020', '', '10/02/2021', '', '', '',
  'Imported from legacy system',
];

/**
 * Canonical CSV columns for bulk contact/company import. One row per CONTACT;
 * rows are grouped into companies by CompanyName on the server (so a company
 * with several contacts is several rows sharing the same CompanyName).
 */
export const COMPANY_IMPORT_COLUMNS: string[] = [
  'CompanyName', 'Type', 'ContactType', 'AddressOne', 'AddressTwo', 'City', 'State', 'Postcode', 'Country',
  'CompanyPhone', 'CompanyEmail', 'Website',
  'ContactName', 'ContactFirstName', 'ContactLastName', 'ContactTitle', 'ContactEmail', 'ContactPhone', 'ContactMobile',
  'Notes',
];

export const COMPANY_IMPORT_EXAMPLE_ROW: string[] = [
  'BrandU Pty Ltd', 'Company', 'Owner', '1 Legal St', '', 'Sydney', 'NSW', '2000', 'Australia',
  '+61 2 9000 0000', 'info@brandu.legal', 'brandu.legal',
  'Jane Client', 'Jane', 'Client', 'Director', 'jane@example.com', '+61 400 000 000', '',
  'Key client',
];

export const COMPANY_IMPORT_COLUMN_NOTES: Record<string, string> = {
  CompanyName: 'Required. Rows sharing a CompanyName are merged into one company with multiple contacts.',
  Type: 'Company, Individual or Partnership. Defaults to Company.',
  ContactType: 'Applicant, Owner, Associate, Opponent, etc. (optional).',
  AddressOne: 'Company street address line 1.',
  AddressTwo: 'Company street address line 2.',
  City: 'Company suburb/city.',
  State: 'Company state/province.',
  Postcode: 'Company postcode/ZIP.',
  Country: 'Company country.',
  CompanyPhone: 'Main company phone.',
  CompanyEmail: 'General company email.',
  Website: 'Company website.',
  ContactName: 'Contact full name (or use First/Last).',
  ContactFirstName: 'Contact first name.',
  ContactLastName: 'Contact surname.',
  ContactTitle: 'Contact position/title.',
  ContactEmail: 'Contact email (used for client emails).',
  ContactPhone: 'Contact direct phone.',
  ContactMobile: 'Contact mobile.',
  Notes: 'Free-text notes on the company.',
};

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
  ResponsibleAttorney: 'The fee earner responsible for the case (drives the dashboard’s "my deadlines").',
  Associate: 'Foreign associate / agent handling the case, if any.',
  AssociateRef: 'The associate’s reference number.',
  Tags: 'Free-form labels separated by ; or , (e.g. "key brand; watch").',
  RenewalFee: 'Estimated renewal fee, numbers only (e.g. 450).',
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
