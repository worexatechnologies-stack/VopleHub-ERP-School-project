import csv
import io
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple


STUDENT_FIELD_SYNONYMS: Dict[str, List[str]] = {
    'name': [
        'student name', 'fullname', 'full name', 'name', 'student',
        'candidate name', 'pupil name', 'first name', 'child name', 'learner name',
    ],
    'admission_no': [
        'admission no', 'admission number', 'adm no', 'adm #', 'admission_no',
        'reg no', 'registration no', 'reg_no', 'enrollment no', 'id', 'student id',
        'roll code', 'admission id', 'adm_no',
    ],
    'class_name': [
        'class', 'grade', 'standard', 'std', 'class name', 'classname', 'current class',
    ],
    'section': [
        'section', 'sec', 'division', 'div', 'section name',
    ],
    'roll_no': [
        'roll no', 'roll number', 'roll #', 'roll', 'roll_no', 'sr no', 'sr. no',
        'serial no', 's.no', 'sno',
    ],
    'parent_name': [
        'parent name', 'parent', 'father name', "father's name", 'guardian',
        'guardian name', 'mother name', "mother's name", 'parent/guardian',
    ],
    'parent_phone': [
        'phone', 'mobile', 'contact', 'parent phone', 'parent mobile', 'contact no',
        'mobile no', 'cell', 'phone number', 'guardian phone', 'whatsapp', 'mobile number',
    ],
    'parent_email': [
        'email', 'parent email', 'email id', 'email address', 'e-mail', 'mail',
    ],
    'dob': [
        'dob', 'date of birth', 'birth date', 'birthdate', 'd.o.b', 'bday', 'birth_date',
    ],
    'gender': [
        'gender', 'sex',
    ],
    'blood_group': [
        'blood group', 'blood', 'bloodgroup', 'bg', 'b.g',
    ],
    'aadhaar': [
        'aadhaar', 'aadhar', 'aadhaar no', 'aadhar number', 'uid', 'aadhaar card', 'national id',
    ],
    'father_name': [
        'father name', "father's name", 'father', 'fathers name',
    ],
    'mother_name': [
        'mother name', "mother's name", 'mother', 'mothers name',
    ],
    'address': [
        'address', 'residential address', 'location', 'residence', 'street', 'permanent address',
    ],
    'medical_conditions': [
        'medical', 'medical conditions', 'health', 'allergies', 'medical notes',
    ],
    'academic_year': [
        'academic year', 'year', 'session', 'batch', 'academic session',
    ],
    'student_password': [
        'password', 'student password', 'temp password', 'temporary password',
        'student pass', 'pass', 'pwd', 'login password', 'credential password',
    ],
    'student_email': [
        'student email', 'student mail', 'student login', 'official student email',
    ],
    'parent_password': [
        'parent password', 'parent pass', 'guardian password', 'parent pwd',
    ],
}

TEACHER_FIELD_SYNONYMS: Dict[str, List[str]] = {
    'name': [
        'teacher name', 'full name', 'name', 'employee name', 'staff name', 'faculty name',
    ],
    'email': [
        'email', 'email id', 'email address', 'official email', 'e-mail',
    ],
    'phone': [
        'phone', 'mobile', 'contact', 'mobile no', 'phone number', 'contact number',
    ],
    'qualification': [
        'qualification', 'degree', 'education', 'highest qualification',
    ],
    'subjects': [
        'subject', 'subjects', 'teaching subject', 'specialization',
    ],
    'assigned_sections': [
        'classes', 'sections', 'assigned classes', 'assigned sections', 'class',
    ],
    'joining_date': [
        'joining date', 'date of joining', 'doj', 'hire date', 'start date',
    ],
    'salary': [
        'salary', 'monthly salary', 'pay', 'ctc',
    ],
    'status': [
        'status', 'employment status',
    ],
    'password': [
        'password', 'temp password', 'temporary password', 'teacher password',
        'pass', 'pwd', 'login password', 'credential password',
    ],
}


def clean_header_string(header: Any) -> str:
    """Normalize a header cell string for fuzzy synonym matching."""
    if header is None:
        return ''
    s = str(header).strip().lower()
    # Replace separators with a single space
    s = re.sub(r'[\t\r\n_\-./#]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def parse_spreadsheet_bytes(file_bytes: bytes, filename: str) -> List[List[Any]]:
    """Parse raw uploaded bytes from .xlsx, .xls, or .csv into a 2D grid."""
    filename_lower = filename.lower()
    rows: List[List[Any]] = []

    if filename_lower.endswith(('.xlsx', '.xlsm', '.xltx')):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
        sheet = wb.active
        for row in sheet.iter_rows(values_only=True):
            if any(cell is not None and str(cell).strip() != '' for cell in row):
                rows.append(list(row))
        wb.close()
    else:
        # Fallback to CSV / TSV with robust encoding detection
        text_content = ''
        for encoding in ('utf-8-sig', 'utf-8', 'latin-1', 'cp1252'):
            try:
                text_content = file_bytes.decode(encoding)
                break
            except UnicodeDecodeError:
                continue

        if not text_content:
            text_content = file_bytes.decode('utf-8', errors='replace')

        # Auto-detect delimiter (, or \t or ;)
        first_line = text_content.splitlines()[0] if text_content.splitlines() else ''
        delimiter = '\t' if '\t' in first_line else (';' if ';' in first_line and ',' not in first_line else ',')

        reader = csv.reader(io.StringIO(text_content), delimiter=delimiter)
        for row in reader:
            if any(cell.strip() != '' for cell in row):
                rows.append(row)

    return rows


def detect_header_and_data(
    rows: List[List[Any]],
    field_synonyms: Dict[str, List[str]],
    max_scan_rows: int = 15,
) -> Tuple[int, List[str], List[List[Any]]]:
    """
    Intelligently discover the genuine header row by scoring rows against
    the known domain synonyms. Skips leading banner rows, empty titles, etc.
    """
    best_row_idx = 0
    best_score = -1
    all_synonyms = {syn for syn_list in field_synonyms.values() for syn in syn_list}

    for idx, row in enumerate(rows[:max_scan_rows]):
        score = 0
        cleaned_cells = [clean_header_string(cell) for cell in row]
        for cell in cleaned_cells:
            if not cell:
                continue
            if cell in all_synonyms:
                score += 3
            elif any(syn in cell or cell in syn for syn in all_synonyms):
                score += 1
        if score > best_score:
            best_score = score
            best_row_idx = idx

    header_row = [str(c or '').strip() for c in rows[best_row_idx]]
    data_rows = rows[best_row_idx + 1 :]
    return best_row_idx, header_row, data_rows


def auto_map_columns(
    raw_headers: List[str],
    field_synonyms: Dict[str, List[str]],
) -> Dict[str, int]:
    """
    Match each target field key to its best matching column index (0-indexed).
    Returns mapping: { field_name: column_index }.
    """
    cleaned_headers = [clean_header_string(h) for h in raw_headers]
    mapping: Dict[str, int] = {}
    used_col_indices = set()

    # Pass 1: Exact matches
    for field, synonyms in field_synonyms.items():
        for col_idx, col_name in enumerate(cleaned_headers):
            if col_idx in used_col_indices or not col_name:
                continue
            if col_name in synonyms:
                mapping[field] = col_idx
                used_col_indices.add(col_idx)
                break

    # Pass 2: Fuzzy / substring matches for unassigned fields
    for field, synonyms in field_synonyms.items():
        if field in mapping:
            continue
        for col_idx, col_name in enumerate(cleaned_headers):
            if col_idx in used_col_indices or not col_name:
                continue
            for syn in synonyms:
                if len(syn) >= 4 and (syn in col_name or col_name in syn):
                    mapping[field] = col_idx
                    used_col_indices.add(col_idx)
                    break
            if field in mapping:
                break

    return mapping


def normalize_date_value(val: Any) -> Optional[str]:
    """Convert various date representations (ISO, DD/MM/YYYY, Excel serial, datetime) to YYYY-MM-DD."""
    if not val:
        return None
    if isinstance(val, (datetime, date)):
        return val.strftime('%Y-%m-%d')

    s = str(val).strip()
    if not s:
        return None

    # Check ISO format: YYYY-MM-DD
    if re.fullmatch(r'\d{4}-\d{1,2}-\d{1,2}', s):
        try:
            return datetime.strptime(s, '%Y-%m-%d').strftime('%Y-%m-%d')
        except ValueError:
            pass

    # Check DD/MM/YYYY or DD-MM-YYYY
    match_dmy = re.fullmatch(r'(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})', s)
    if match_dmy:
        d, m, y = map(int, match_dmy.groups())
        try:
            return date(y, m, d).strftime('%Y-%m-%d')
        except ValueError:
            pass

    # Check MM/DD/YYYY
    match_mdy = re.fullmatch(r'(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})', s)
    if match_mdy:
        p1, p2, yr = map(int, match_mdy.groups())
        if yr < 100:
            yr += 2000 if yr < 50 else 1900
        # Try both d/m and m/d
        for d, m in [(p1, p2), (p2, p1)]:
            try:
                return date(yr, m, d).strftime('%Y-%m-%d')
            except ValueError:
                continue

    # Numeric Excel serial date (e.g. 44561)
    if re.fullmatch(r'\d{5}', s):
        try:
            serial = int(s)
            return (datetime(1899, 12, 30) + datetime.timedelta(days=serial)).strftime('%Y-%m-%d')
        except Exception:
            pass

    return None


def normalize_phone_number(val: Any) -> str:
    """Extract standard digits for phone numbers."""
    if not val:
        return ''
    raw = str(val).strip()
    # Strip decimals if Excel converted integer phone to float (e.g. 9876543210.0)
    if raw.endswith('.0'):
        raw = raw[:-2]
    digits = re.sub(r'\D+', '', raw)
    if len(digits) > 10 and digits.startswith('91'):
        digits = digits[2:]
    return digits[-10:] if len(digits) >= 10 else digits


def normalize_gender_value(val: Any) -> str:
    """Normalize gender strings to Male, Female, or Other."""
    if not val:
        return 'Other'
    s = str(val).strip().lower()
    if s in ['m', 'male', 'boy', 'b']:
        return 'Male'
    if s in ['f', 'female', 'girl', 'g']:
        return 'Female'
    return 'Other'
