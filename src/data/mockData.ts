import {
  Book,
  ChatMessage,
  CompetitiveExam,
  CourseMaterial,
  ExamSchedule,
  FeeReceipt,
  GradeCard,
  HomeSubject,
  Student,
  Teacher,
  TimetableSlot,
  TransportRoute,
} from '../types';

export const INITIAL_STUDENTS: Student[] = [];
export const INITIAL_TEACHERS: Teacher[] = [];
export const CLASS_TIMETABLES: { [className: string]: TimetableSlot[] } = {};
export const ONLINE_COURSES: CourseMaterial[] = [];
export const INITIAL_FEE_RECEIPTS: FeeReceipt[] = [];
export const INITIAL_BOOKS: Book[] = [];
export const TRANSPORT_ROUTES: TransportRoute[] = [];
export const INITIAL_CHATS: ChatMessage[] = [];
export const ACADEMIC_EVENTS: { date: string; title: string; category: string }[] = [];
export const EXAM_SCHEDULES: ExamSchedule[] = [];
export const GRADE_CARDS: GradeCard[] = [];
export const QUIZZES: {
  id: string;
  subject: string;
  question: string;
  options: string[];
  correct: number;
  explanation: string;
}[] = [];
export const COMPETITIVE_EXAMS: CompetitiveExam[] = [];
export const HOME_SUBJECTS: HomeSubject[] = [];
export const PRACTICE_TESTS: any[] = [];
