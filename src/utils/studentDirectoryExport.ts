import XLSX, { downloadStyledWorkbook, styleWorksheet } from './excelStyler';
import type { Student } from '../types';

export const STUDENT_EXPORT_FIELDS = [
  { key: 'admissionNo', label: 'Admission No' },
  { key: 'name', label: 'Student Name' },
  { key: 'class', label: 'Class' },
  { key: 'section', label: 'Section' },
  { key: 'rollNo', label: 'Roll No' },
  { key: 'academicYear', label: 'Academic Year' },
  { key: 'status', label: 'Status' },
  { key: 'gender', label: 'Gender' },
  { key: 'dob', label: 'Date of Birth' },
  { key: 'fatherName', label: 'Father Name' },
  { key: 'motherName', label: 'Mother Name' },
  { key: 'parentName', label: 'Parent / Guardian' },
  { key: 'parentPhone', label: 'Parent Phone' },
  { key: 'parentEmail', label: 'Parent Email' },
  { key: 'address', label: 'Address' },
  { key: 'attendancePercentage', label: 'Attendance %' },
  { key: 'feeTotal', label: 'Total Fees (₹)' },
  { key: 'feePaid', label: 'Fees Paid (₹)' },
  { key: 'gpa', label: 'GPA' },
] as const;

type StudentExportField = (typeof STUDENT_EXPORT_FIELDS)[number]['key'];

export function exportStudentDirectoryToExcel(students: Student[], selectedFields: string[], schoolName: string): void {
  const fields = STUDENT_EXPORT_FIELDS.filter((field) => selectedFields.includes(field.key as StudentExportField));
  const rows = students.map((student) => Object.fromEntries(fields.map(({ key, label }) => [label, student[key as StudentExportField] ?? ''])));
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: fields.map((field) => field.label) });
  worksheet['!cols'] = fields.map((field) => ({ wch: Math.max(14, Math.min(30, field.label.length + 4)) }));
  styleWorksheet(worksheet, { theme: 'navy', hasTotalRow: false });
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Students');
  const safeSchoolName = (schoolName || 'School').replace(/[^a-zA-Z0-9]+/g, '_');
  downloadStyledWorkbook(workbook, `${safeSchoolName}_Students_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
