import XLSX from 'xlsx-js-style';

export type HeaderTheme = 'navy' | 'indigo' | 'emerald' | 'teal' | 'slate';

export interface StyleWorksheetOptions {
  /**
   * Number of header rows at the top (default: 1)
   */
  headerRows?: number;
  /**
   * Theme palette for the header row
   */
  theme?: HeaderTheme;
  /**
   * Automatically detect and style total / grand total summary rows at the bottom
   */
  hasTotalRow?: boolean;
  /**
   * 0-based column indices or header names to format as currency (right-aligned, numeric format)
   */
  currencyCols?: (number | string)[];
  /**
   * 0-based column indices or header names to format as center-aligned (e.g. S.No, ID, Date, Status)
   */
  centerCols?: (number | string)[];
  /**
   * Custom column widths in character units (wch)
   */
  colWidths?: number[];
}

const THEME_COLORS: Record<HeaderTheme, { fill: string; font: string }> = {
  navy: { fill: '1E293B', font: 'FFFFFF' },     // Slate 800 / Navy
  indigo: { fill: '312E81', font: 'FFFFFF' },   // Indigo 900
  emerald: { fill: '065F46', font: 'FFFFFF' },  // Emerald 800
  teal: { fill: '115E59', font: 'FFFFFF' },     // Teal 800
  slate: { fill: '334155', font: 'FFFFFF' },    // Slate 700
};

const BORDER_THIN = {
  top: { style: 'thin', color: { rgb: 'CBD5E1' } },
  bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
  left: { style: 'thin', color: { rgb: 'CBD5E1' } },
  right: { style: 'thin', color: { rgb: 'CBD5E1' } },
};

const BORDER_TOTAL = {
  top: { style: 'thin', color: { rgb: '475569' } },
  bottom: { style: 'double', color: { rgb: '0F172A' } },
  left: { style: 'thin', color: { rgb: 'CBD5E1' } },
  right: { style: 'thin', color: { rgb: 'CBD5E1' } },
};

/**
 * Returns tailored badge colors for accounting, inventory, and fulfillment statuses.
 */
function getStatusBadgeStyle(value: string): { fill: string; font: string } | null {
  const v = value.trim().toUpperCase();

  // Success / Verified / Paid / In Stock
  if (
    v === 'PAID' ||
    v === 'FULFILLED' ||
    v === 'ACTIVE' ||
    v === 'ACTIVE ON STORE' ||
    v === 'IN STOCK' ||
    v === 'IN STOCK - HEALTHY' ||
    v === 'TARGET MET' ||
    v === 'VERIFIED' ||
    v === 'SUCCESS' ||
    v.includes('PERFECT TALLY') ||
    v.includes('PERFECT AUDIT')
  ) {
    return { fill: 'DCFCE7', font: '166534' }; // Emerald
  }

  // Warning / Pending / Low Stock
  if (
    v === 'PENDING' ||
    v === 'PARTIAL' ||
    v === 'AWAITING PAYMENT' ||
    v === 'READY FOR COLLECTION' ||
    v === 'LOW STOCK' ||
    v.includes('LOW STOCK ALERT') ||
    v === 'PENDING SETTLEMENT' ||
    v === 'SUSPENDED'
  ) {
    return { fill: 'FEF3C7', font: '92400E' }; // Amber
  }

  // Danger / Overdue / Out of stock / Problem
  if (
    v === 'OVERDUE' ||
    v === 'FAILED' ||
    v === 'CANCELLED' ||
    v === 'EXPIRED' ||
    v === 'OUT OF STOCK' ||
    v === 'SOLD OUT' ||
    v === 'TC_ISSUED' ||
    v === 'TC ISSUED' ||
    v === 'INACTIVE' ||
    v === 'INACTIVE / HIDDEN' ||
    v.includes('MISMATCH') ||
    v.includes('AUDIT CHECK') ||
    v.includes('VARIANCE')
  ) {
    return { fill: 'FFE4E6', font: '9F1239' }; // Rose
  }

  // Info / Mode / Category
  if (
    v === 'LOCAL DEMO FLOW' ||
    v === 'RAZORPAY ONLINE' ||
    v === 'DIRECT VERIFIED'
  ) {
    return { fill: 'E0F2FE', font: '075985' }; // Sky
  }

  return null;
}

/**
 * Applies executive styling to an XLSX worksheet:
 * - High-contrast professional header with custom theme
 * - Alternating zebra rows (white / soft slate-50)
 * - Accounting grid borders (thin slate-300)
 * - Automatic status badge colors (Paid, Pending, Low Stock, etc.)
 * - Classic accounting double-underline summary/totals rows
 * - Proper number alignments (numeric right, codes center, descriptions left)
 */
export function styleWorksheet(
  ws: XLSX.WorkSheet,
  options: StyleWorksheetOptions = {}
): XLSX.WorkSheet {
  if (!ws || !ws['!ref']) return ws;

  const {
    headerRows = 1,
    theme = 'navy',
    hasTotalRow = true,
    colWidths,
  } = options;

  const range = XLSX.utils.decode_range(ws['!ref']);
  const themeConfig = THEME_COLORS[theme] || THEME_COLORS.navy;

  // Extract header labels to map column names to column indexes
  const headerLabels: string[] = [];
  for (let c = range.s.c; c <= range.e.c; ++c) {
    const cellAddr = XLSX.utils.encode_cell({ r: range.s.r, c });
    const cell = ws[cellAddr];
    headerLabels[c] = cell && cell.v != null ? String(cell.v).trim().toLowerCase() : '';
  }

  // Determine which columns are currency, center, or quantities based on options or auto-detection
  const isCurrencyCol = (c: number): boolean => {
    if (options.currencyCols) {
      return options.currencyCols.some((opt) =>
        typeof opt === 'number' ? opt === c : headerLabels[c]?.includes(opt.toLowerCase())
      );
    }
    const label = headerLabels[c] || '';
    return label.includes('(₹)') || label.includes('price') || label.includes('fee') || label.includes('amount') || label.includes('salary') || label.includes('total') || label.includes('balance') || label.includes('revenue') || label.includes('valuation');
  };

  const isCenterCol = (c: number): boolean => {
    if (options.centerCols) {
      return options.centerCols.some((opt) =>
        typeof opt === 'number' ? opt === c : headerLabels[c]?.includes(opt.toLowerCase())
      );
    }
    const label = headerLabels[c] || '';
    return label === 's.no' || label.includes('id') || label.includes('date') || label.includes('time') || label.includes('phone') || label.includes('status') || label.includes('class') || label.includes('section') || label.includes('year') || label.includes('roll') || label.includes('qty');
  };

  // Iterate through all cells in range
  for (let r = range.s.r; r <= range.e.r; ++r) {
    const isHeader = r < range.s.r + headerRows;

    // Detect if this is a total/summary row
    let isTotalRow = false;
    if (hasTotalRow && !isHeader) {
      const firstCell = ws[XLSX.utils.encode_cell({ r, c: range.s.c })];
      const val = firstCell && firstCell.v != null ? String(firstCell.v).trim().toUpperCase() : '';
      if (val === 'TOTAL' || val === 'TOTALS' || val === 'GRAND TOTAL' || val === 'GRAND TOTALS' || r === range.e.r) {
        // Also check adjacent cell if first cell is empty
        const secondCell = ws[XLSX.utils.encode_cell({ r, c: range.s.c + 1 })];
        const val2 = secondCell && secondCell.v != null ? String(secondCell.v).trim().toUpperCase() : '';
        if (val.includes('TOTAL') || val2.includes('TOTAL') || r === range.e.r) {
          isTotalRow = true;
        }
      }
    }

    const isEvenRow = (r - range.s.r - headerRows) % 2 === 0;
    const rowBg = isEvenRow ? 'FFFFFF' : 'F8FAFC';

    for (let c = range.s.c; c <= range.e.c; ++c) {
      const cellAddr = XLSX.utils.encode_cell({ r, c });
      let cell = ws[cellAddr];

      if (!cell) {
        // Create blank cell so grid styling and borders are uninterrupted
        cell = { t: 's', v: '' };
        ws[cellAddr] = cell;
      }

      if (isHeader) {
        // --- HEADER STYLING ---
        cell.s = {
          fill: { fgColor: { rgb: themeConfig.fill } },
          font: {
            name: 'Calibri',
            sz: 11,
            bold: true,
            color: { rgb: themeConfig.font },
          },
          alignment: {
            vertical: 'center',
            horizontal: 'center',
            wrapText: true,
          },
          border: {
            top: { style: 'medium', color: { rgb: themeConfig.fill } },
            bottom: { style: 'medium', color: { rgb: '0F172A' } },
            left: { style: 'thin', color: { rgb: '475569' } },
            right: { style: 'thin', color: { rgb: '475569' } },
          },
        };
      } else if (isTotalRow) {
        // --- TOTAL / SUMMARY ROW STYLING (CLASSIC DOUBLE ACCOUNTING UNDERLINE) ---
        cell.s = {
          fill: { fgColor: { rgb: 'EEF2FF' } }, // Soft Indigo highlight
          font: {
            name: 'Calibri',
            sz: 11,
            bold: true,
            color: { rgb: '1E1B4B' },
          },
          alignment: {
            vertical: 'center',
            horizontal: isCurrencyCol(c) ? 'right' : isCenterCol(c) ? 'center' : 'left',
          },
          border: BORDER_TOTAL,
        };
        if (typeof cell.v === 'number' && isCurrencyCol(c)) {
          cell.z = '#,##0.00';
        }
      } else {
        // --- DATA ROW STYLING ---
        const cellStr = cell.v != null ? String(cell.v).trim() : '';
        const badge = getStatusBadgeStyle(cellStr);

        let horizontalAlign: 'left' | 'center' | 'right' = 'left';
        if (typeof cell.v === 'number') {
          horizontalAlign = isCenterCol(c) ? 'center' : 'right';
        } else if (isCenterCol(c) || badge) {
          horizontalAlign = 'center';
        }

        cell.s = {
          fill: { fgColor: { rgb: badge ? badge.fill : rowBg } },
          font: {
            name: 'Calibri',
            sz: 10,
            bold: Boolean(badge),
            color: { rgb: badge ? badge.font : '1E293B' },
          },
          alignment: {
            vertical: 'center',
            horizontal: horizontalAlign,
          },
          border: BORDER_THIN,
        };

        if (typeof cell.v === 'number' && isCurrencyCol(c)) {
          cell.z = '#,##0.00';
        }
      }
    }
  }

  // Set row heights
  const rowCount = range.e.r - range.s.r + 1;
  const rowHeights = [];
  for (let r = 0; r < rowCount; ++r) {
    if (r < headerRows) {
      rowHeights.push({ hpt: 26 }); // Header row height
    } else {
      rowHeights.push({ hpt: 20 }); // Data row height
    }
  }
  ws['!rows'] = rowHeights;

  // Apply or preserve column widths
  if (colWidths && colWidths.length > 0) {
    ws['!cols'] = colWidths.map((wch) => ({ wch }));
  }

  return ws;
}

/**
 * Converts a styled XLSX workbook to binary buffer, sets the official
 * Microsoft Excel OpenXML MIME type, and triggers an immediate safe browser download.
 */
export function downloadStyledWorkbook(wb: XLSX.WorkBook, filename: string): void {
  const excelArrayBuffer = XLSX.write(wb, {
    bookType: 'xlsx',
    type: 'array',
    cellStyles: true,
  });

  const excelBlob = new Blob([excelArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  if (typeof window !== 'undefined') {
    const url = window.URL.createObjectURL(excelBlob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = url;
    downloadAnchor.download = filename;
    downloadAnchor.style.display = 'none';
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    setTimeout(() => {
      document.body.removeChild(downloadAnchor);
      window.URL.revokeObjectURL(url);
    }, 250);
  }
}

export { XLSX };
export default XLSX;