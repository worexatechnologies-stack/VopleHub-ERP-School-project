import * as XLSX from 'xlsx';

export interface ColumnDefinition {
  key: string;
  label: string;
  required: boolean;
  synonyms: string[];
  description: string;
  example: string;
}

export const STUDENT_COLUMNS: ColumnDefinition[] = [
  {
    key: 'name',
    label: 'Student Name',
    required: true,
    synonyms: ['student name', 'fullname', 'full name', 'name', 'student', 'candidate name', 'pupil name', 'first name', 'child name'],
    description: 'Full name of the student',
    example: 'Aarav Sharma',
  },
  {
    key: 'class',
    label: 'Class / Grade',
    required: true,
    synonyms: ['class', 'grade', 'standard', 'std', 'class name', 'classname', 'current class'],
    description: 'Class name (e.g. Class 10, Grade 9)',
    example: 'Class 10',
  },
  {
    key: 'section',
    label: 'Section',
    required: false,
    synonyms: ['section', 'sec', 'division', 'div', 'section name'],
    description: 'Class Section (e.g. A, B)',
    example: 'A',
  },
  {
    key: 'admissionNo',
    label: 'Admission No',
    required: false,
    synonyms: ['admission no', 'admission number', 'adm no', 'adm #', 'admission_no', 'reg no', 'registration no', 'reg_no', 'enrollment no', 'id', 'student id', 'admission id', 'adm_no'],
    description: 'Unique admission number (auto-generated if empty)',
    example: 'ADM-2026-001',
  },
  {
    key: 'rollNo',
    label: 'Roll No',
    required: false,
    synonyms: ['roll no', 'roll number', 'roll #', 'roll', 'roll_no', 'sr no', 'sr. no', 'serial no', 'sno'],
    description: 'Roll number in class section',
    example: '1',
  },
  {
    key: 'parentName',
    label: 'Parent / Guardian Name',
    required: false,
    synonyms: ['parent name', 'parent', 'father name', "father's name", 'guardian', 'guardian name', 'mother name', "mother's name", 'parent/guardian'],
    description: "Primary guardian's name",
    example: 'Rajesh Sharma',
  },
  {
    key: 'parentPhone',
    label: 'Parent Phone / Mobile',
    required: false,
    synonyms: ['phone', 'mobile', 'contact', 'parent phone', 'parent mobile', 'contact no', 'mobile no', 'cell', 'phone number', 'guardian phone', 'whatsapp', 'mobile number'],
    description: '10-digit mobile number for portal SMS/login',
    example: '9876543210',
  },
  {
    key: 'parentEmail',
    label: 'Parent Email',
    required: false,
    synonyms: ['email', 'parent email', 'email id', 'email address', 'e-mail', 'mail'],
    description: 'Parent login email address',
    example: 'parent.sharma@example.com',
  },
  {
    key: 'dob',
    label: 'Date of Birth',
    required: false,
    synonyms: ['dob', 'date of birth', 'birth date', 'birthdate', 'd.o.b', 'bday', 'birth_date'],
    description: 'Date of birth (YYYY-MM-DD or DD/MM/YYYY)',
    example: '2011-05-18',
  },
  {
    key: 'gender',
    label: 'Gender',
    required: false,
    synonyms: ['gender', 'sex'],
    description: 'Male, Female, or Other',
    example: 'Male',
  },
  {
    key: 'bloodGroup',
    label: 'Blood Group',
    required: false,
    synonyms: ['blood group', 'blood', 'bloodgroup', 'bg', 'b.g'],
    description: 'Blood group (A+, B+, O+, etc.)',
    example: 'B+',
  },
  {
    key: 'aadhaar',
    label: 'Aadhaar / UID',
    required: false,
    synonyms: ['aadhaar', 'aadhar', 'aadhaar no', 'aadhar number', 'uid', 'aadhaar card', 'national id'],
    description: '12-digit Aadhaar number',
    example: '123456789012',
  },
  {
    key: 'address',
    label: 'Residential Address',
    required: false,
    synonyms: ['address', 'residential address', 'location', 'residence', 'street', 'city', 'permanent address'],
    description: 'Student residential address',
    example: '42 MG Road, Bangalore',
  },
  {
    key: 'academicYear',
    label: 'Academic Year',
    required: false,
    synonyms: ['academic year', 'year', 'session', 'batch', 'academic session'],
    description: 'Academic year (e.g. 2026-2027)',
    example: '2026-2027',
  },
  {
    key: 'studentEmail',
    label: 'Student Email',
    required: false,
    synonyms: ['student email', 'student mail', 'student_email', 'student email id', 'student e-mail'],
    description: 'Student login email address (auto-generated if empty)',
    example: 'aarav.sharma@school.edu',
  },
  {
    key: 'studentPassword',
    label: 'Student Password',
    required: false,
    synonyms: ['student password', 'student pwd', 'student pass', 'student_password', 'student pin', 'student passcode'],
    description: 'Custom initial password for student login (auto-generated if empty)',
    example: 'Student@123',
  },
  {
    key: 'parentPassword',
    label: 'Parent Password',
    required: false,
    synonyms: ['parent password', 'parent pwd', 'parent pass', 'parent_password', 'guardian password', 'parent pin'],
    description: 'Custom initial password for parent login (auto-generated if empty)',
    example: 'Parent@123',
  },
];

export const TEACHER_COLUMNS: ColumnDefinition[] = [
  {
    key: 'name',
    label: 'Teacher Name',
    required: true,
    synonyms: ['teacher name', 'full name', 'name', 'employee name', 'staff name', 'faculty name'],
    description: 'Full name of teacher',
    example: 'Dr. Priya Sundaram',
  },
  {
    key: 'email',
    label: 'Email Address',
    required: true,
    synonyms: ['email', 'email id', 'email address', 'official email', 'e-mail'],
    description: 'Teacher login email',
    example: 'priya.s@school.edu',
  },
  {
    key: 'phone',
    label: 'Phone / Mobile',
    required: false,
    synonyms: ['phone', 'mobile', 'contact', 'mobile no', 'phone number', 'contact number'],
    description: '10-digit mobile number',
    example: '9845012345',
  },
  {
    key: 'qualification',
    label: 'Qualification',
    required: false,
    synonyms: ['qualification', 'degree', 'education', 'highest qualification'],
    description: 'Degrees & qualifications (e.g. M.Sc, B.Ed)',
    example: 'M.Sc, B.Ed',
  },
  {
    key: 'subjects',
    label: 'Subjects Taught',
    required: false,
    synonyms: ['subject', 'subjects', 'teaching subject', 'specialization'],
    description: 'Comma-separated subjects (e.g. Mathematics, Physics)',
    example: 'Mathematics, Physics',
  },
  {
    key: 'joiningDate',
    label: 'Date of Joining',
    required: false,
    synonyms: ['joining date', 'date of joining', 'doj', 'hire date', 'start date'],
    description: 'Date of joining (YYYY-MM-DD)',
    example: '2024-06-01',
  },
  {
    key: 'salary',
    label: 'Monthly Salary',
    required: false,
    synonyms: ['salary', 'monthly salary', 'pay', 'ctc'],
    description: 'Monthly salary amount',
    example: '45000',
  },
  {
    key: 'password',
    label: 'Password',
    required: false,
    synonyms: ['password', 'teacher password', 'temp password', 'initial password', 'pwd', 'pass', 'staff password', 'teacher_password'],
    description: 'Custom initial password for teacher login (auto-generated if empty)',
    example: 'Teacher@123',
  },
];

export interface ColumnMapping {
  fieldKey: string;
  fieldLabel: string;
  isRequired: boolean;
  columnIndex: number; // -1 if unmapped
  headerName: string;
  confidence: number; // 0 to 100
}

export interface ParsedRowResult {
  rowNumber: number;
  data: Record<string, any>;
  isValid: boolean;
  errors: string[];
  warnings: string[];
  included: boolean;
}

export interface ParsedSpreadsheetReport {
  fileName: string;
  headerRowIndex: number;
  rawHeaders: string[];
  totalRawRows: number;
  mappings: ColumnMapping[];
  unmappedColumns: Array<{ columnIndex: number; headerName: string }>;
  rows: ParsedRowResult[];
  readyCount: number;
  warningCount: number;
  errorCount: number;
}

export function cleanHeaderString(header: any): string {
  if (header == null) return '';
  return String(header)
    .trim()
    .toLowerCase()
    .replace(/[\t\r\n_\-./#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses an Excel (.xlsx/.xls) or CSV File, or pasted TSV/CSV string, into raw rows.
 */
export async function parseFileOrText(fileOrText: File | string): Promise<{ rawRows: any[][]; fileName: string }> {
  if (typeof fileOrText === 'string') {
    // Process pasted text from Excel or Google Sheets
    const lines = fileOrText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (!lines.length) return { rawRows: [], fileName: 'Pasted Data' };

    // Detect delimiter
    const firstLine = lines[0];
    const delimiter = firstLine.includes('\t') ? '\t' : (firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',');

    const rawRows = lines.map((line) => {
      if (delimiter === '\t') {
        return line.split('\t').map((c) => c.trim());
      }
      // Simple CSV split taking quotes into account
      const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
      return matches ? matches.map((m) => m.replace(/^"|"$/g, '').trim()) : line.split(delimiter).map((c) => c.trim());
    });

    return { rawRows, fileName: 'Pasted Sheet Data' };
  }

  // File object (.xlsx, .xls, .csv)
  const arrayBuffer = await fileOrText.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

  return { rawRows, fileName: fileOrText.name };
}

/**
 * Discovers the real table header row by scanning up to 15 rows and scoring synonyms.
 */
export function detectHeaderRow(
  rawRows: any[][],
  columnsDef: ColumnDefinition[],
  maxScanRows = 15
): { headerRowIndex: number; headers: string[]; dataRows: any[][] } {
  let bestRowIndex = 0;
  let bestScore = -1;

  const allSynonyms = new Set<string>();
  columnsDef.forEach((col) => col.synonyms.forEach((syn) => allSynonyms.add(syn)));

  const scanLimit = Math.min(rawRows.length, maxScanRows);
  for (let r = 0; r < scanLimit; r++) {
    const row = rawRows[r] || [];
    let score = 0;
    row.forEach((cell) => {
      const cleaned = cleanHeaderString(cell);
      if (!cleaned) return;
      if (allSynonyms.has(cleaned)) {
        score += 3;
      } else {
        for (const syn of allSynonyms) {
          if (cleaned.includes(syn) || syn.includes(cleaned)) {
            score += 1;
            break;
          }
        }
      }
    });

    if (score > bestScore) {
      bestScore = score;
      bestRowIndex = r;
    }
  }

  const headerRow = (rawRows[bestRowIndex] || []).map((c) => String(c ?? '').trim());
  const dataRows = rawRows.slice(bestRowIndex + 1);

  return {
    headerRowIndex: bestRowIndex,
    headers: headerRow,
    dataRows,
  };
}

/**
 * Matches target schema fields with the sheet headers.
 */
export function autoMapColumns(headers: string[], columnsDef: ColumnDefinition[]): ColumnMapping[] {
  const cleanedHeaders = headers.map(cleanHeaderString);
  const usedColIndices = new Set<number>();
  const mappings: ColumnMapping[] = [];

  // Pass 1: Exact matches
  for (const colDef of columnsDef) {
    let matchedCol = -1;
    let confidence = 0;

    for (let cIdx = 0; cIdx < cleanedHeaders.length; cIdx++) {
      if (usedColIndices.has(cIdx) || !cleanedHeaders[cIdx]) continue;
      if (colDef.synonyms.includes(cleanedHeaders[cIdx])) {
        matchedCol = cIdx;
        confidence = 100;
        usedColIndices.add(cIdx);
        break;
      }
    }

    if (matchedCol !== -1) {
      mappings.push({
        fieldKey: colDef.key,
        fieldLabel: colDef.label,
        isRequired: colDef.required,
        columnIndex: matchedCol,
        headerName: headers[matchedCol] || `Column ${matchedCol + 1}`,
        confidence,
      });
    }
  }

  // Pass 2: Fuzzy / Substring matches
  for (const colDef of columnsDef) {
    if (mappings.some((m) => m.fieldKey === colDef.key)) continue;

    let matchedCol = -1;
    let confidence = 0;

    for (let cIdx = 0; cIdx < cleanedHeaders.length; cIdx++) {
      if (usedColIndices.has(cIdx) || !cleanedHeaders[cIdx]) continue;
      const head = cleanedHeaders[cIdx];
      for (const syn of colDef.synonyms) {
        if (syn.length >= 3 && (head.includes(syn) || syn.includes(head))) {
          matchedCol = cIdx;
          confidence = 85;
          usedColIndices.add(cIdx);
          break;
        }
      }
      if (matchedCol !== -1) break;
    }

    mappings.push({
      fieldKey: colDef.key,
      fieldLabel: colDef.label,
      isRequired: colDef.required,
      columnIndex: matchedCol,
      headerName: matchedCol !== -1 ? headers[matchedCol] : '(Unmapped)',
      confidence: matchedCol !== -1 ? confidence : 0,
    });
  }

  return mappings;
}

/**
 * Normalizes dates from various formats (Excel serial, ISO, DD/MM/YYYY, MM/DD/YYYY).
 */
export function normalizeDate(val: any): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString().split('T')[0];
  }
  const s = String(val).trim();
  if (!s) return null;

  // YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Excel serial number (e.g. 44561)
  if (/^\d{5}$/.test(s)) {
    const serial = Number(s);
    const dateObj = new Date((serial - 25569) * 86400 * 1000);
    if (!isNaN(dateObj.getTime())) {
      return dateObj.toISOString().split('T')[0];
    }
  }

  return null;
}

/**
 * Normalizes phone numbers to standard 10 digits.
 */
export function normalizePhone(val: any): string {
  if (!val) return '';
  let s = String(val).trim();
  if (s.endsWith('.0')) s = s.slice(0, -2);
  const digits = s.replace(/\D+/g, '');
  if (digits.length > 10 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Normalizes gender value.
 */
export function normalizeGender(val: any): 'Male' | 'Female' | 'Other' {
  if (!val) return 'Male';
  const s = String(val).trim().toLowerCase();
  if (['m', 'male', 'boy', 'b'].includes(s)) return 'Male';
  if (['f', 'female', 'girl', 'g'].includes(s)) return 'Female';
  return 'Other';
}

/**
 * Organizes and validates raw rows according to column mappings and entity rules.
 */
export function organizeAndValidateRows(
  dataRows: any[][],
  mappings: ColumnMapping[],
  entityType: 'students' | 'teachers',
  defaults: {
    defaultClass?: string;
    defaultSection?: string;
    defaultAcademicYear?: string;
  } = {}
): ParsedRowResult[] {
  const seenAdmissionNos = new Set<string>();
  const seenEmails = new Set<string>();
  const results: ParsedRowResult[] = [];

  // Build field -> columnIndex lookup
  const fieldIndexMap: Record<string, number> = {};
  mappings.forEach((m) => {
    if (m.columnIndex >= 0) {
      fieldIndexMap[m.fieldKey] = m.columnIndex;
    }
  });

  dataRows.forEach((row, rIdx) => {
    // Skip totally empty rows
    const hasData = row.some((c) => c != null && String(c).trim() !== '');
    if (!hasData) return;

    const rowNumber = rIdx + 1;
    const errors: string[] = [];
    const warnings: string[] = [];
    const itemData: Record<string, any> = { _rowNum: rowNumber };

    // Extract fields based on mapping
    for (const [fieldKey, colIdx] of Object.entries(fieldIndexMap)) {
      itemData[fieldKey] = row[colIdx] ?? '';
    }

    if (entityType === 'students') {
      // Validate Name
      const name = String(itemData.name || '').trim();
      itemData.name = name;
      if (!name) {
        errors.push('Student name is required');
      }

      // Class
      let className = String(itemData.class || '').trim();
      if (!className && defaults.defaultClass) {
        className = defaults.defaultClass;
        warnings.push(`Class defaulted to '${className}'`);
      }
      itemData.class = className || 'Class 1';

      // Section
      let section = String(itemData.section || '').trim().toUpperCase();
      if (!section && defaults.defaultSection) {
        section = defaults.defaultSection;
      }
      itemData.section = section || 'A';

      // Academic Year
      let ay = String(itemData.academicYear || '').trim();
      if (!ay && defaults.defaultAcademicYear) {
        ay = defaults.defaultAcademicYear;
      }
      itemData.academicYear = ay || defaults.defaultAcademicYear || '2026-2027';

      // Admission Number
      const adm = String(itemData.admissionNo || '').trim();
      if (adm) {
        if (seenAdmissionNos.has(adm.toLowerCase())) {
          warnings.push(`Duplicate admission number '${adm}' in sheet (will auto-allocate unique sequence)`);
        } else {
          seenAdmissionNos.add(adm.toLowerCase());
        }
        itemData.admissionNo = adm;
      } else {
        warnings.push('Admission number will be auto-generated');
      }

      // Roll Number
      const rawRoll = itemData.rollNo;
      const numRoll = Number(String(rawRoll).trim());
      itemData.rollNo = !isNaN(numRoll) && numRoll > 0 ? numRoll : 0;
      if (itemData.rollNo === 0) {
        warnings.push('Roll number will be auto-assigned sequentially');
      }

      // Phone
      const phone = normalizePhone(itemData.parentPhone);
      itemData.parentPhone = phone;
      if (phone && phone.length < 10) {
        warnings.push('Phone number has fewer than 10 digits');
      }

      // Email
      const email = String(itemData.parentEmail || '').trim();
      itemData.parentEmail = email;

      // DOB
      const dob = normalizeDate(itemData.dob);
      itemData.dob = dob || '2014-06-15';
      if (!dob && itemData.dob) {
        warnings.push('Could not parse birth date, defaulted to standard school age');
      }

      // Gender
      itemData.gender = normalizeGender(itemData.gender);

      // Parent Name
      if (!itemData.parentName && name) {
        itemData.parentName = `${name}'s Parent`;
      }

      // Login & Password customizations
      if (itemData.studentPassword) {
        itemData.studentPassword = String(itemData.studentPassword).trim();
      }
      if (itemData.parentPassword) {
        itemData.parentPassword = String(itemData.parentPassword).trim();
      }
      if (itemData.studentEmail) {
        itemData.studentEmail = String(itemData.studentEmail).trim();
      }
    } else {
      // Teacher validation
      const name = String(itemData.name || '').trim();
      itemData.name = name;
      if (!name) errors.push('Teacher name is required');

      const email = String(itemData.email || '').trim().toLowerCase();
      itemData.email = email;
      if (!email || !email.includes('@')) {
        warnings.push('Missing/invalid email: an official school email will be auto-generated');
      } else if (seenEmails.has(email)) {
        errors.push(`Duplicate email '${email}' in sheet`);
      } else {
        seenEmails.add(email);
      }

      itemData.phone = normalizePhone(itemData.phone);
      itemData.joiningDate = normalizeDate(itemData.joiningDate) || '2026-01-01';
      itemData.qualification = String(itemData.qualification || 'B.Ed').trim();
      if (itemData.password) {
        itemData.password = String(itemData.password).trim();
      }
    }

    const isValid = errors.length === 0;

    results.push({
      rowNumber,
      data: itemData,
      isValid,
      errors,
      warnings,
      included: isValid,
    });
  });

  return results;
}

/**
 * Generates and triggers download of a sample Excel template (.xlsx).
 */
export function downloadSampleExcelTemplate(entityType: 'students' | 'teachers') {
  const wb = XLSX.utils.book_new();

  if (entityType === 'students') {
    const sampleHeaders = [
      'Admission No',
      'Student Name',
      'Class',
      'Section',
      'Roll No',
      'Date of Birth',
      'Gender',
      'Parent Name',
      'Parent Mobile',
      'Parent Email',
      'Student Password',
      'Parent Password',
      'Blood Group',
      'Aadhaar Number',
      'Residential Address',
      'Academic Year',
    ];
    const sampleData = [
      [
        'ADM2026-001',
        'Aarav Sharma',
        'Class 10',
        'A',
        1,
        '2010-04-15',
        'Male',
        'Rajesh Sharma',
        '9876543210',
        'rajesh.sharma@example.com',
        'Student@123',
        'Parent@123',
        'B+',
        '458912345678',
        '24 MG Road, Bengaluru',
        '2026-2027',
      ],
      [
        'ADM2026-002',
        'Diya Patel',
        'Class 10',
        'A',
        2,
        '2010-09-22',
        'Female',
        'Kiran Patel',
        '9876543211',
        'kiran.patel@example.com',
        'Student@123',
        'Parent@123',
        'O+',
        '558912345679',
        '18 Residency Road, Bengaluru',
        '2026-2027',
      ],
      [
        'ADM2026-003',
        'Rohan Verma',
        'Class 10',
        'B',
        1,
        '2010-11-05',
        'Male',
        'Sunil Verma',
        '9876543212',
        'sunil.verma@example.com',
        'Student@123',
        'Parent@123',
        'A+',
        '658912345680',
        '104 Indiranagar, Bengaluru',
        '2026-2027',
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet([sampleHeaders, ...sampleData]);
    ws['!cols'] = sampleHeaders.map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Students_Template');
    XLSX.writeFile(wb, 'student_enrollment_template.xlsx');
  } else {
    const sampleHeaders = [
      'Teacher Name',
      'Email',
      'Password',
      'Mobile No',
      'Qualification',
      'Subjects Taught',
      'Date of Joining',
      'Monthly Salary',
    ];
    const sampleData = [
      [
        'Dr. Priya Sundaram',
        'priya.sundaram@school.edu',
        'Teacher@123',
        '9845012345',
        'M.Sc, B.Ed',
        'Mathematics, Physics',
        '2024-06-01',
        '45000',
      ],
      [
        'Ramesh Kumar',
        'ramesh.kumar@school.edu',
        'Teacher@123',
        '9845012346',
        'M.A, B.Ed',
        'English Literature',
        '2023-08-15',
        '42000',
      ],
    ];

    const ws = XLSX.utils.aoa_to_sheet([sampleHeaders, ...sampleData]);
    ws['!cols'] = sampleHeaders.map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Teachers_Template');
    XLSX.writeFile(wb, 'teacher_directory_template.xlsx');
  }
}
