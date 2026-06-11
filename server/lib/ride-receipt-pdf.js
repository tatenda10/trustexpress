import PDFDocument from 'pdfkit';
import { buildRideStopsPayload } from './ride-stops.js';

const BLUE = '#114D7E';
const LIGHT_GREEN = '#E8F3D7';
const GREEN = '#2E7D32';
const TEXT = '#111827';
const MUTED = '#6B7280';
const LINE = '#D6D6D6';
const CARD = '#F7F5F2';

function currency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function shortDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-ZW', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function shortDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-ZW', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function shortName(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('@') || raw.startsWith('user_')) return fallback;
  return raw;
}

function sectionTitle(doc, label, y) {
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(6).text(label, 24, y, {
    characterSpacing: 0.4,
  });
}

function divider(doc, y) {
  doc.strokeColor(LINE).lineWidth(0.6).moveTo(24, y).lineTo(296, y).stroke();
}

function labelValue(doc, label, value, x, y, options = {}) {
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(6).text(label, x, y, {
    width: options.labelWidth || 92,
  });
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(options.size || 8).text(String(value || '-'), x, y + 10, {
    width: options.width || 92,
    lineGap: 1,
  });
}

function drawPersonCard(doc, x, y, title, initials, name) {
  doc.roundedRect(x, y, 126, 64, 4).fill(CARD);
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(6).text(title, x + 10, y + 9);
  doc.circle(x + 18, y + 28, 9).fill('#EAF2FF');
  doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(7).text(initials, x + 12, y + 25, {
    width: 12,
    align: 'center',
  });
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8).text(name, x + 10, y + 46, {
    width: 106,
  });
}

function drawRoutePoint(doc, y, label, value, isLast = false) {
  doc.circle(28, y + 13, 3).fill(BLUE);
  if (!isLast) {
    doc.strokeColor('#9BB6D4').lineWidth(0.7).moveTo(28, y + 18).lineTo(28, y + 42).stroke();
  }
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(6).text(label, 42, y + 4);
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8).text(value || '-', 42, y + 15, {
    width: 232,
    lineGap: 1,
  });
}

export function writeRideReceiptPdf(res, ride, options = {}) {
  const doc = new PDFDocument({ size: [320, 740], margin: 0 });
  doc.pipe(res);

  const fareAmount = Number(ride.final_estimated_amount || ride.estimated_amount || 0);
  const originalFareAmount = Number(ride.original_estimated_amount || fareAmount);
  const discountAmount = Number(ride.discount_amount || 0);
  const tipAmount = Number(ride.tip_amount || 0);
  const totalAmount = fareAmount + tipAmount;
  const completedAt = ride.completed_at || new Date();
  const statusLabel = options.statusLabel || 'Completed';
  const passengerName = shortName(ride.passenger_name, 'Passenger');
  const driverName = shortName(ride.driver_name, 'Driver');
  const passengerInitials = passengerName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'P';
  const driverInitials = driverName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'D';
  const intermediateStops = buildRideStopsPayload(ride).intermediateStops;
  const routeRows = [
    { label: 'PICKUP', value: ride.pickup_label, color: BLUE },
    ...intermediateStops.map((stop, index) => ({
      label: `STOP ${index + 1}`,
      value: stop?.label || `Stop ${index + 1}`,
      color: '#F97316',
    })),
    { label: 'DROP-OFF', value: ride.dropoff_label, color: BLUE },
  ];

  doc.rect(0, 0, 320, 740).fill('#FFFFFF');
  doc.roundedRect(8, 8, 304, 724, 3).strokeColor('#CFCFCF').lineWidth(0.7).stroke();

  doc.rect(8, 8, 304, 90).fill(BLUE);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7).text('TRUST EXPRESS', 0, 28, {
    width: 320,
    align: 'center',
    characterSpacing: 0.6,
  });
  doc.fontSize(16).text('Trip receipt', 0, 42, { width: 320, align: 'center' });
  doc.font('Helvetica').fontSize(8).text(shortDate(completedAt), 0, 62, { width: 320, align: 'center' });

  doc.rect(8, 98, 304, 38).fill(LIGHT_GREEN);
  doc.circle(28, 117, 3).fill(GREEN);
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(7).text(statusLabel, 38, 112);
  doc.fillColor(GREEN).font('Helvetica').fontSize(6).text(`RCPT-${ride.id}`, 250, 112, {
    width: 42,
    align: 'right',
  });

  sectionTitle(doc, 'ROUTE', 154);
  let routeY = 168;
  routeRows.forEach((row, index) => {
    drawRoutePoint(doc, routeY, row.label, row.value, index === routeRows.length - 1);
    routeY += 44;
  });
  divider(doc, routeY + 8);

  const peopleSectionY = routeY + 26;
  sectionTitle(doc, 'PEOPLE', peopleSectionY);
  drawPersonCard(doc, 24, peopleSectionY + 18, 'PASSENGER', passengerInitials, passengerName);
  drawPersonCard(doc, 164, peopleSectionY + 18, 'DRIVER', driverInitials, driverName);
  divider(doc, peopleSectionY + 100);

  const tripDetailsY = peopleSectionY + 118;
  sectionTitle(doc, 'TRIP DETAILS', tripDetailsY);
  labelValue(doc, 'Trip ID', ride.public_id || ride.id, 24, tripDetailsY + 16, { width: 106 });
  labelValue(doc, 'Requested', shortDateTime(ride.requested_at), 24, tripDetailsY + 46, { width: 106 });
  labelValue(doc, 'Completed', shortDateTime(ride.completed_at), 24, tripDetailsY + 76, { width: 106 });
  labelValue(doc, 'Service tier', ride.requested_tier_name || 'Trust Express', 24, tripDetailsY + 106, { width: 106 });
  doc.fillColor(TEXT).font('Helvetica').fontSize(8).text(`TR-${String(ride.id).padStart(5, '0')}`, 190, tripDetailsY + 26, {
    width: 86,
    align: 'right',
  });
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8).text(shortDateTime(ride.requested_at), 170, tripDetailsY + 56, {
    width: 106,
    align: 'right',
  });
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8).text(shortDateTime(ride.completed_at), 170, tripDetailsY + 86, {
    width: 106,
    align: 'right',
  });
  doc.roundedRect(178, tripDetailsY + 115, 98, 18, 9).fill('#EAF2FF');
  doc.circle(190, tripDetailsY + 124, 4).fill('#5A9CF2');
  doc.fillColor(BLUE).font('Helvetica-Bold').fontSize(7).text(ride.requested_tier_name || 'Trust Express', 198, tripDetailsY + 120, {
    width: 70,
  });
  divider(doc, tripDetailsY + 152);

  const fareY = tripDetailsY + 170;
  sectionTitle(doc, 'FARE BREAKDOWN', fareY);
  doc.fillColor(TEXT).font('Helvetica').fontSize(8).text('Original fare', 24, fareY + 24);
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8).text(currency(originalFareAmount), 230, fareY + 24, {
    width: 46,
    align: 'right',
  });
  doc.fillColor(TEXT).font('Helvetica').fontSize(8).text('Discount', 24, fareY + 48);
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8).text(`-${currency(discountAmount)}`, 230, fareY + 48, {
    width: 46,
    align: 'right',
  });
  doc.fillColor(TEXT).font('Helvetica').fontSize(8).text('Fare', 24, fareY + 72);
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8).text(currency(fareAmount), 230, fareY + 72, {
    width: 46,
    align: 'right',
  });
  doc.fillColor(TEXT).font('Helvetica').fontSize(8).text('Tip', 24, fareY + 96);
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(8).text(currency(tipAmount), 230, fareY + 96, {
    width: 46,
    align: 'right',
  });
  divider(doc, fareY + 120);

  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9).text('Total charged', 24, fareY + 136);
  doc.fillColor(BLUE).font('Courier').fontSize(15).text(currency(totalAmount), 210, fareY + 131, {
    width: 66,
    align: 'right',
  });

  doc.fillColor(MUTED).font('Helvetica').fontSize(6).text(
    options.footerText || 'Thank you for driving with Trust Express!',
    0,
    720,
    { width: 320, align: 'center' },
  );
  doc.fontSize(5).text('Safe rides. Trusted drivers. Always.', 0, 730, {
    width: 320,
    align: 'center',
  });

  doc.end();
}
