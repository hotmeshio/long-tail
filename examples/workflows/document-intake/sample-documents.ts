import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** What the sample application says; the extraction deliberately misreads some of it. */
export const SAMPLE_APPLICANT = {
  first_name: 'John',
  last_name: 'Okafor',
  date_of_birth: '1987-04-03',
  email: 'john.okafor@example.com',
  phone: '(503) 555-0142',
  account_type: 'joint',
  street: '41 Harbor Lane',
  city: 'Portland',
  postal_code: '97205',
} as const;

/** A one-page Acme account application, as a scanned form would read. */
export async function buildApplicationPdf(applicationId: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Acme account application ${applicationId}`);
  const page = doc.addPage([612, 792]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.12);
  const rule = rgb(0.75, 0.75, 0.78);

  page.drawText('ACME', { x: 56, y: 730, size: 22, font: bold, color: ink });
  page.drawText('Account Application', { x: 56, y: 706, size: 14, font: regular, color: ink });
  page.drawText(`Application ${applicationId}`, { x: 400, y: 730, size: 9, font: regular, color: ink });

  const rows: Array<[string, string]> = [
    ['First name', SAMPLE_APPLICANT.first_name],
    ['Last name', SAMPLE_APPLICANT.last_name],
    ['Date of birth (MM/DD/YYYY)', '04/03/1987'],
    ['Email', SAMPLE_APPLICANT.email],
    ['Phone', SAMPLE_APPLICANT.phone],
    ['Street', SAMPLE_APPLICANT.street],
    ['City', SAMPLE_APPLICANT.city],
    ['Postal code', SAMPLE_APPLICANT.postal_code],
  ];
  let y = 650;
  for (const [label, value] of rows) {
    page.drawText(label, { x: 56, y: y + 14, size: 8, font: regular, color: ink });
    page.drawText(value, { x: 56, y, size: 13, font: regular, color: ink });
    page.drawLine({ start: { x: 56, y: y - 6 }, end: { x: 556, y: y - 6 }, thickness: 0.5, color: rule });
    y -= 48;
  }

  page.drawText('Account type', { x: 56, y: y + 14, size: 8, font: regular, color: ink });
  const boxes: Array<[string, boolean]> = [['Individual', false], ['Joint', true], ['Business', false]];
  boxes.forEach(([label, ticked], i) => {
    const x = 56 + i * 120;
    page.drawRectangle({ x, y: y - 2, width: 10, height: 10, borderColor: ink, borderWidth: 0.8 });
    if (ticked) page.drawText('x', { x: x + 2, y: y, size: 10, font: bold, color: ink });
    page.drawText(label, { x: x + 16, y, size: 11, font: regular, color: ink });
  });

  page.drawText('Signature', { x: 56, y: 120, size: 8, font: regular, color: ink });
  page.drawText('J. Okafor', { x: 56, y: 96, size: 18, font: regular, color: ink });
  page.drawLine({ start: { x: 56, y: 90 }, end: { x: 300, y: 90 }, thickness: 0.5, color: rule });
  return Buffer.from(await doc.save());
}

/** The ID card sent with the application, as an image. */
export function buildIdCardSvg(): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="856" height="540" viewBox="0 0 856 540">
  <rect width="856" height="540" rx="28" fill="#f4f4f2"/>
  <rect x="0" y="0" width="856" height="96" rx="28" fill="#1f2a44"/>
  <rect x="0" y="60" width="856" height="36" fill="#1f2a44"/>
  <text x="40" y="62" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="#ffffff">ACME IDENTIFICATION</text>
  <rect x="40" y="136" width="210" height="260" rx="8" fill="#d9dbe0"/>
  <circle cx="145" cy="230" r="54" fill="#b7bbc4"/>
  <rect x="85" y="296" width="120" height="80" rx="40" fill="#b7bbc4"/>
  <g font-family="Helvetica, Arial, sans-serif" fill="#1a1a1e">
    <text x="290" y="160" font-size="18" fill="#5a5d66">NAME</text>
    <text x="290" y="196" font-size="34">${SAMPLE_APPLICANT.first_name.toUpperCase()} ${SAMPLE_APPLICANT.last_name.toUpperCase()}</text>
    <text x="290" y="250" font-size="18" fill="#5a5d66">DATE OF BIRTH</text>
    <text x="290" y="286" font-size="30">04/03/1987</text>
    <text x="290" y="340" font-size="18" fill="#5a5d66">ADDRESS</text>
    <text x="290" y="372" font-size="24">${SAMPLE_APPLICANT.street}, ${SAMPLE_APPLICANT.city}</text>
    <text x="40" y="480" font-size="20" fill="#5a5d66">ID 4471-0093-2218</text>
  </g>
</svg>`;
  return Buffer.from(svg, 'utf8');
}
