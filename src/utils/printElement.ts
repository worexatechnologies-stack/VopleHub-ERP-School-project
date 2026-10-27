/** Print an existing React-rendered element without reparsing its HTML string. */
export function printElement(elementId: string, title: string): void {
  const source = document.getElementById(elementId);
  if (!source) {
    window.print();
    return;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    window.print();
    return;
  }

  // The print window does not need access to the opener or its DOM.
  printWindow.opener = null;
  const printDocument = printWindow.document;
  printDocument.title = title;

  const csp = printDocument.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data: https:; base-uri 'none'; form-action 'none'";
  printDocument.head.appendChild(csp);

  document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style').forEach((node) => {
    printDocument.head.appendChild(node.cloneNode(true));
  });

  const printStyles = printDocument.createElement('style');
  printStyles.textContent = `
    @page { size: A4 landscape; margin: 4mm; }
    @media print {
      html, body { width: 289mm !important; height: auto !important; margin: 0 !important; padding: 0 !important; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
      .hall-ticket-print-page {
        box-sizing: border-box !important;
        width: 289mm !important;
        height: 202mm !important;
        max-height: 202mm !important;
        margin: 0 !important;
        padding: 5mm !important;
        overflow: hidden !important;
        border-width: 1px !important;
        border-radius: 4mm !important;
        box-shadow: none !important;
        break-inside: avoid !important;
        page-break-inside: avoid !important;
        page-break-after: auto !important;
        font-size: 8pt !important;
      }
      .hall-ticket-print-page > :not([hidden]) ~ :not([hidden]) { margin-top: 2.5mm !important; }
      .hall-ticket-print-page .hall-ticket-header { gap: 3mm !important; padding-bottom: 3mm !important; }
      .hall-ticket-print-page .hall-ticket-header img { width: 14mm !important; height: 14mm !important; }
      .hall-ticket-print-page h1 { font-size: 17pt !important; margin-top: 1mm !important; }
      .hall-ticket-print-page h2 { font-size: 11pt !important; }
      .hall-ticket-print-page .grid { display: grid !important; }
      .hall-ticket-print-page .grid.grid-cols-2 { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
      .hall-ticket-print-page .hall-ticket-invigilator-signature { width: 23mm !important; height: 10mm !important; }
      .hall-ticket-print-page .hall-ticket-controller-signature { width: 32mm !important; height: 10mm !important; }
      .hall-ticket-print-page th, .hall-ticket-print-page td { padding: 1.5mm 1mm !important; font-size: 7pt !important; }
      .hall-ticket-print-page ol { margin: 0 !important; }
      .hall-ticket-print-page li { margin: 0 !important; line-height: 1.25 !important; }
      .hall-ticket-print-page .hall-ticket-signatures { padding-top: 3mm !important; gap: 3mm !important; }
      #hall-tickets-container { display: block !important; }
      #hall-tickets-container > .grid { display: block !important; }
      #hall-tickets-container .hall-ticket-print-page:not(:last-child) { break-after: page !important; page-break-after: always !important; }
      .store-order-print-sheet {
        display: block !important;
        width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        color: #0f172a !important;
        background: #ffffff !important;
        font-family: Arial, sans-serif !important;
        font-size: 8pt !important;
      }
      .store-print-report-heading {
        display: flex !important;
        align-items: flex-end !important;
        justify-content: space-between !important;
        gap: 8mm !important;
        margin-bottom: 5mm !important;
        padding-bottom: 3mm !important;
        border-bottom: 2px solid #4f46e5 !important;
      }
      .store-print-report-heading h1 { margin: 1mm 0 !important; font-size: 16pt !important; font-weight: 800 !important; }
      .store-print-report-heading p { margin: 0 !important; color: #64748b !important; font-size: 8pt !important; }
      .store-print-report-heading .store-print-eyebrow { color: #4f46e5 !important; font-size: 7pt !important; font-weight: 800 !important; text-transform: uppercase !important; letter-spacing: .08em !important; }
      .store-print-orders-table {
        display: table !important;
        width: 100% !important;
        min-width: 0 !important;
        table-layout: fixed !important;
        border-collapse: collapse !important;
        border: 1px solid #cbd5e1 !important;
        font-size: 7.5pt !important;
      }
      .store-print-orders-table thead { display: table-header-group !important; }
      .store-print-orders-table tr { break-inside: avoid !important; page-break-inside: avoid !important; }
      .store-print-orders-table th, .store-print-orders-table td {
        display: table-cell !important;
        padding: 2.2mm !important;
        border: 1px solid #cbd5e1 !important;
        text-align: left !important;
        vertical-align: top !important;
        white-space: normal !important;
        overflow-wrap: anywhere !important;
        font-size: 7.5pt !important;
        line-height: 1.3 !important;
      }
      .store-print-orders-table th { background: #f1f5f9 !important; color: #334155 !important; font-size: 7pt !important; font-weight: 800 !important; text-transform: uppercase !important; }
      .store-print-orders-table td strong { display: block !important; margin-bottom: 1mm !important; color: #0f172a !important; font-weight: 800 !important; }
      .store-print-orders-table td span { display: block !important; margin-top: .7mm !important; color: #475569 !important; }
    }
  `;
  printDocument.head.appendChild(printStyles);

  printDocument.body.className = 'bg-white p-6';
  printDocument.body.replaceChildren(source.cloneNode(true));

  printWindow.focus();
  printWindow.setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 500);
}
