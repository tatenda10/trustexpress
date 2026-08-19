import { Buffer } from 'node:buffer';

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? (0xedb88320 ^ (crc >>> 1)) : crc >>> 1;
  }
  CRC_TABLE[index] = crc >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnLetter(index) {
  let value = index + 1;
  let letter = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    value = Math.floor((value - 1) / 26);
  }
  return letter;
}

function toDosTime(date = new Date()) {
  const year = Math.max(date.getFullYear() - 1980, 0);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = (year << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

function zipStore(files) {
  const { dosTime, dosDate } = toDosTime();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuffer = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function buildSheetXml(columns, rows) {
  const headerCells = columns.map((column, index) => {
    const ref = `${columnLetter(index)}1`;
    return `<c r="${ref}" t="inlineStr" s="1"><is><t>${xmlEscape(column.header)}</t></is></c>`;
  }).join('');

  const body = rows.map((row, rowIndex) => {
    const excelRow = rowIndex + 2;
    const cells = columns.map((column, colIndex) => {
      const ref = `${columnLetter(colIndex)}${excelRow}`;
      const value = row[column.key] == null ? '' : String(row[column.key]);
      const style = column.text === true ? '2' : '0';
      return `<c r="${ref}" t="inlineStr" s="${style}"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join('');
    return `<row r="${excelRow}">${cells}</row>`;
  }).join('');

  const colDefs = columns.map((column, index) => {
    const width = Number(column.width || 22);
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${colDefs}</cols>
  <sheetData>
    <row r="1">${headerCells}</row>
    ${body}
  </sheetData>
</worksheet>`;
}

export function buildXlsxBuffer({ sheetName = 'Export', columns = [], rows = [] } = {}) {
  const safeSheetName = String(sheetName || 'Export').slice(0, 31);
  const sheetXml = buildSheetXml(columns, rows);

  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${xmlEscape(safeSheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1">
    <numFmt numFmtId="164" formatCode="@"/>
  </numFmts>
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf/>
  </cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: sheetXml,
    },
  ];

  return zipStore(files);
}

export function sendXlsx(res, { filename, sheetName, columns, rows }) {
  const buffer = buildXlsxBuffer({ sheetName, columns, rows });
  const safeName = String(filename || 'export.xlsx').replace(/"/g, '');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Content-Length', String(buffer.length));
  return res.status(200).send(buffer);
}

export function formatExportName(item) {
  const fullName = String(item?.fullName || '').trim();
  if (fullName) return fullName;
  const joined = [item?.firstName, item?.lastName].filter(Boolean).join(' ').trim();
  if (joined) return joined;
  return String(item?.email || item?.id || '').trim();
}

export function formatPhoneAsText(value) {
  return String(value || '').trim();
}

export function formatCompliantStatus(isCompliant) {
  return isCompliant ? 'Compliant' : 'Not compliant';
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isApprovedStatus(value) {
  return ['approved', 'verified'].includes(normalizeStatus(value));
}

function formatCheckStatus(status, { submitted = false } = {}) {
  const normalized = normalizeStatus(status);
  if (isApprovedStatus(normalized)) return 'approved';
  if (normalized === 'rejected') return 'rejected';
  if (normalized === 'pending' || submitted) return 'pending review';
  return 'not submitted';
}

export function describeDriverVerification(driver) {
  const phoneVerified = driver?.phoneVerified === true;
  const identityStatus = formatCheckStatus(driver?.profile?.status, {
    submitted: !!driver?.profile?.hasDocuments || !!driver?.profile?.submittedAt,
  });
  const vehicleStatus = formatCheckStatus(driver?.vehicle?.status, {
    submitted: !!driver?.vehicle?.hasDocuments || !!driver?.vehicle?.submittedAt,
  });

  const identityApproved = identityStatus === 'approved';
  const vehicleApproved = vehicleStatus === 'approved';
  const identityStarted = identityStatus !== 'not submitted';
  const vehicleStarted = vehicleStatus !== 'not submitted';
  const fullyVerified = phoneVerified && identityApproved && vehicleApproved;
  const noDocuments = !identityStarted && !vehicleStarted;

  let verificationStatus = 'Partially verified';
  if (fullyVerified) verificationStatus = 'Fully verified';
  else if (noDocuments) verificationStatus = 'Account only — no documents';

  return {
    verificationStatus,
    identityStatus,
    vehicleStatus,
    details: [
      phoneVerified ? 'Phone verified' : 'Phone not verified',
      `Identity ${identityStatus}`,
      `Vehicle ${vehicleStatus}`,
    ].join(' · '),
  };
}

export function describePassengerVerification(passenger) {
  const phoneVerified = passenger?.phoneVerified === true;
  const identityStatus = formatCheckStatus(passenger?.passengerIdentity?.status, {
    submitted: !!passenger?.passengerIdentity?.submittedAt
      || !!passenger?.passengerIdentity?.nationalIdFrontUrl
      || !!passenger?.passengerIdentity?.selfieUrl,
  });
  const identityApproved = identityStatus === 'approved';
  const identityStarted = identityStatus !== 'not submitted';
  const fullyVerified = phoneVerified && identityApproved;

  let verificationStatus = 'Partially verified';
  if (fullyVerified) verificationStatus = 'Fully verified';
  else if (!identityStarted) verificationStatus = 'Account only — no documents';

  return {
    verificationStatus,
    identityStatus,
    details: [
      phoneVerified ? 'Phone verified' : 'Phone not verified',
      `Identity ${identityStatus}`,
    ].join(' · '),
  };
}
