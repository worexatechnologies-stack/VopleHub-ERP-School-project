export type UserRole =
  | 'Super Admin'
  | 'School Admin'
  | 'Principal'
  | 'Teacher'
  | 'Student'
  | 'Parent'
  | 'Accountant'
  | 'Librarian'
  | 'Transport Manager'
  | 'Public Learner';

export interface StudentDocument {
  id?: number;
  name: string;
  category?: string;
  status: 'Uploaded' | 'Pending' | 'Verified' | 'Rejected';
  fileType: string;
  fileName?: string;
  remarks?: string;
  uploadedAt?: string;
  verifiedAt?: string;
  downloadUrl?: string;
}

export interface Student {
  id: string;
  admissionNo: string;
  name: string;
  class: string;
  classId?: number;
  section: string;
  sectionId?: number;
  rollNo: number;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  dob: string;
  gender: string;
  address: string;
  medicalConditions: string;
  qrCodeData: string;
  status: 'Active' | 'Promoted' | 'TC_Issued';
  photoUrl?: string;
  photoFile?: File;
  academicYear: string;
  bloodGroup?: string;
  aadhaar?: string;
  fatherName?: string;
  motherName?: string;
  attendancePercentage?: number;
  feeTotal?: number;
  feePaid?: number;
  gpa?: number;
  documents?: StudentDocument[];
  history?: { academicYear: string; class: string; section: string; gpa?: number; attendance?: number; status: string }[];
}

export interface Teacher {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  phone: string;
  designation: string;
  qualification: string;
  assignedSubjects: string[];
  status: 'Active' | 'Inactive';
  photoUrl?: string;
  photoFile?: File;
}

export interface TimetableSlot {
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';
  period: number;
  time: string;
  subject: string;
  teacher: string;
}

export interface CourseMaterial {
  id: string;
  title: string;
  type: 'video' | 'pdf' | 'notes';
  url: string;
  duration?: string;
  pages?: number;
  class: string;
  subject: string;
  uploadDate: string;
}

export interface FeeReceipt {
  id: string;
  studentId: string;
  studentName: string;
  class: string;
  category: 'Tuition' | 'Transport' | 'Exam' | 'Admission';
  amount: number;
  discount: number;
  paidAmount: number;
  paymentMethod: 'UPI' | 'Razorpay' | 'Cash';
  transactionId: string;
  paymentDate: string;
  status: 'Paid' | 'Pending' | 'Overdue';
}

export interface Book {
  id: string;
  isbn: string;
  title: string;
  author: string;
  category: string;
  totalCopies: number;
  availableCopies: number;
  shelfLocation: string;
}

export interface TransportRoute {
  id: string;
  routeName: string;
  busNumber: string;
  driverName: string;
  driverPhone: string;
  stops: { name: string; time: string; lat: number; lng: number }[];
  currentLocation?: { lat: number; lng: number };
}

export interface ChatMessage {
  id: string;
  senderRole: UserRole;
  senderName: string;
  message: string;
  timestamp: string;
}

export interface ExamScheduleItemRecord {
  id?: number;
  subject?: number | null;
  subject_id?: number | null;
  subject_name: string;
  exam_date: string;
  start_time: string;
  end_time: string;
  max_marks: number;
  order?: number;
}

export interface ExamTimetableRecord {
  id: number;
  name: string;
  classroom: number;
  classroom_name?: string;
  class_name: string;
  school_name?: string;
  academic_year?: string;
  status: 'draft' | 'published';
  published_at?: string | null;
  hall_tickets_generated?: boolean;
  hall_tickets_released?: boolean;
  hall_tickets_released_at?: string | null;
  marks_published?: boolean;
  marks_published_at?: string | null;
  report_cards_generated?: boolean;
  report_cards_published?: boolean;
  report_cards_published_at?: string | null;
  marks_entry_days?: number;
  marks_entry_deadline?: string | null;
  marks_entry_extended?: boolean;
  marks_entry_extension_reason?: string;
  marks_entry_extended_at?: string | null;
  marks_entry_status?: 'open' | 'expired' | 'extended' | 'upcoming';
  marks_entry_is_open?: boolean;
  marks_entry_effective_deadline?: string | null;
  exam_completion_date?: string | null;
  section_extensions?: Record<string, any>;
  is_teacher_assigned?: boolean;
  teacher_assigned_sections?: string[];
  teacher_assigned_subjects?: string[];
  items: ExamScheduleItemRecord[];
  sections: string[];
  created_at?: string;
  updated_at?: string;
}

export interface ReportCardPaper {
  subject_name: string;
  max_marks: number;
  marks_obtained: number;
  percentage: number;
  grade: string;
  remarks: string;
}

export interface OfficialReportCardRecord {
  id: string;
  report_card_no: string;
  schedule_id: number;
  school_name?: string;
  exam_name: string;
  academic_year: string;
  class_name: string;
  section: string;
  student_id: number;
  student_name: string;
  admission_no: string;
  roll_no: number;
  parent_name?: string;
  photo_url?: string;
  papers: ReportCardPaper[];
  total_obtained: number;
  total_max: number;
  percentage: number;
  grade: string;
  gpa: number;
  result_status: string;
  rank: number;
  total_candidates: number;
  status: 'draft' | 'generated' | 'published';
  is_published: boolean;
  published_at?: string | null;
  conduct_remarks?: string;
}

export interface HallTicketPaper {
  subject_name: string;
  exam_date: string;
  start_time: string;
  end_time: string;
  max_marks: number;
  room_number?: string;
}

export interface HallTicketRecord {
  id: string;
  hall_ticket_no: string;
  schedule_id: number;
  school_name?: string;
  exam_name: string;
  academic_year: string;
  class_name: string;
  section: string;
  student_id: number;
  student_name: string;
  admission_no: string;
  roll_no: number;
  parent_name?: string;
  photo_url?: string;
  emergency_contact?: string;
  papers: HallTicketPaper[];
  status: 'draft' | 'pending_approval' | 'released';
  is_released: boolean;
  released_at?: string | null;
  instructions: string[];
}

export interface ExamSchedule {
  id: string;
  examName: string;
  class: string;
  section?: string;
  subject: string;
  date: string;
  time: string;
  maxMarks: number;
}

export interface GradeCard {
  studentId: string;
  studentName: string;
  class: string;
  academicYear: string;
  marks: { [subject: string]: { marksObtained: number; maxMarks: number; grade: string } };
  gpa: number;
  rank: number;
  attendancePercentage: number;
  remarks: string;
}

export interface BrandSettings {
  schoolName: string;
  logoType: 'icon' | 'image';
  logoIcon: 'School' | 'GraduationCap' | 'Compass' | 'BookOpen' | 'Crown' | 'ShieldCheck' | 'Globe' | 'Trophy' | 'Award' | 'Palette';
  logoImageUrl: string;
  logoMonogram: string;
  primaryColor: string;
  secondaryColor: string;
  theme?: 'default' | '3d-white' | 'glass-academy';
}

export interface CompetitiveExam {
  id: string;
  examName: string;
  title: string;
  description: string;
  badge: string;
  color?: string;
  eligibility: string;
  totalPosts: string;
  level: string;
  syllabus: string[];
  syllabusUrl?: string;
  studyMaterials: CourseMaterial[];
}

export interface HomeSubject {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  totalLessons: number;
  freeCount: number;
}

export interface PracticeTest {
  id: string;
  title: string;
  category: 'General' | 'KPSC' | 'PSI' | 'FDA' | 'UPSC';
  durationMinutes: number;
  totalMarks: number;
  questions: {
    id: string;
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
    topic: string;
  }[];
}

export interface AnalyticsResult {
  testId: string;
  score: number;
  totalMarks: number;
  accuracyPercentage: number;
  timeTakenMinutes: number;
  topicScores: { [topic: string]: { correct: number; total: number } };
}

export interface PublicLearnerRecord {
  id: string;
  name: string;
  email: string;
  password: string;
  plan: 'Monthly' | 'Quarterly' | 'Annual';
  status: 'Active' | 'Expired' | 'Suspended';
  paymentDate: string;
  expiryDate: string;
  phone?: string;
  notes?: string;
}
