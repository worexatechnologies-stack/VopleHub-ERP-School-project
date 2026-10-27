/**
 * Mapping utilities between internal portal tabs and user-friendly browser URLs.
 * Supports clean kebab-case URLs (e.g. /admin-dashboard, /student-directory),
 * direct links, browser history back/forward navigation, and deep linking.
 */

export function getUrlForTab(tabId: string, role?: string): string {
  switch (tabId) {
    case 'dashboard':
      if (role === 'Teacher') return '/teacher-dashboard';
      if (role === 'Parent') return '/parent-portal';
      if (role === 'Student') return '/student-portal';
      return '/admin-dashboard';

    case 'super-admin-dashboard':
      return '/super-admin-dashboard';
    case 'super-admin-schools':
      return '/super-admin-schools';
    case 'super-admin-admins':
      return '/super-admin-admins';
    case 'super-admin-sys-settings':
      return '/super-admin-settings';

    case 'academic-setup':
      return '/academic-setup';
    case 'admissions':
      return '/online-admissions';
    case 'student':
      return '/student-directory';
    case 'teachers':
      return '/teacher-profiles';
    case 'passwords':
      return '/password-manager';
    case 'academic':
      if (role === 'Parent') return '/child-timetable';
      if (role === 'Student') return '/my-timetable';
      if (role === 'Teacher') return '/academic-schedules';
      return '/timetables';
    case 'homework':
      return '/class-homework';
    case 'attendance':
      if (role === 'Teacher') return '/mark-attendance';
      if (role === 'Parent') return '/ward-attendance';
      return '/roster-attendance';
    case 'fees':
      if (role === 'Parent') return '/fee-desk';
      if (role === 'Student') return '/my-fees';
      return '/fees-invoicing';
    case 'staff-fee':
      return '/staff-fee';
    case 'salary-details':
      return '/salary-details';
    case 'teacher-documents':
      return '/teacher-documents';
    case 'student-documents':
      return '/student-documents';
    case 'exams':
      if (role === 'Parent' || role === 'Student') return '/exam-reports';
      return '/exams-grading';
    case 'promotion':
      return '/promotion';
    case 'communication':
      if (role === 'Parent') return '/teacher-chat';
      if (role === 'Student') return '/class-notices';
      return '/communications';
    case 'community-events':
      return '/community-events';
    case 'notifications':
      return '/school-notices';
    case 'notify-teachers':
      return '/notify-teachers';
    case 'notify-parents':
      return '/notify-parents';
    case 'notify-students':
      return '/notify-students';
    case 'library':
      return '/library';
    case 'transport':
      if (role === 'Parent') return '/transport-tracker';
      return '/transport-gps';
    case 'learning':
      return '/learning';
    case 'store':
      return '/store';

    default:
      return `/${tabId.replace(/_/g, '-')}`;
  }
}

export function getTabForUrl(rawPath: string, role?: string): string | null {
  if (!rawPath) return null;
  let path = decodeURIComponent(rawPath).trim().toLowerCase();
  path = path.split('?')[0].split('#')[0];
  path = path.replace(/^\/+|\/+$/g, '');
  if (!path) return null;

  if (path.startsWith('app/')) {
    path = path.slice(4).replace(/^\/+|\/+$/g, '');
  }

  // Replace spaces or encoded space artifacts with hyphens
  const slug = path.replace(/\s+/g, '-');

  switch (slug) {
    case 'admin-dashboard':
    case 'dashboard':
    case 'teacher-dashboard':
    case 'parent-portal':
    case 'parent-dashboard':
    case 'student-portal':
    case 'student-dashboard':
      return 'dashboard';

    case 'admin':
    case 'admin-portal':
      return role === 'Super Admin' ? 'super-admin-dashboard' : 'dashboard';

    case 'super-admin':
      return role && role !== 'Super Admin' ? 'dashboard' : 'super-admin-dashboard';

    case 'super-admin-dashboard':
    case 'overview-dashboard':
      return 'super-admin-dashboard';

    case 'super-admin-schools':
    case 'schools':
    case 'school-branches':
    case 'branches':
      return 'super-admin-schools';

    case 'super-admin-admins':
    case 'school-admins':
    case 'admins':
      return 'super-admin-admins';

    case 'super-admin-settings':
    case 'system-settings':
    case 'super-admin-sys-settings':
      return 'super-admin-sys-settings';

    case 'academic-setup':
    case 'setup':
      return 'academic-setup';

    case 'online-admissions':
    case 'admissions-portal':
    case 'admissions-review':
      return 'admissions';

    case 'student-directory':
    case 'students':
    case 'student':
      return 'student';

    case 'teacher-profiles':
    case 'teachers':
    case 'teacher-directory':
    case 'faculty':
      return 'teachers';

    case 'password-manager':
    case 'passwords':
      return 'passwords';

    case 'timetables':
    case 'schedules':
    case 'timetables-schedules':
    case 'academic':
    case 'child-timetable':
    case 'my-timetable':
    case 'academic-schedules':
      return 'academic';

    case 'class-homework':
    case 'homework':
      return 'homework';

    case 'roster-attendance':
    case 'attendance':
    case 'mark-attendance':
    case 'ward-attendance':
      return 'attendance';

    case 'fees-invoicing':
    case 'fees':
    case 'fee-desk':
    case 'my-fees':
    case 'fee-ledger':
      return 'fees';

    case 'staff-fee':
      return 'staff-fee';

    case 'salary-details':
    case 'teacher-salary':
      return 'salary-details';

    case 'teacher-documents':
    case 'my-documents':
      return 'teacher-documents';

    case 'student-documents':
      return 'student-documents';

    case 'exams-grading':
    case 'exams':
    case 'exam-reports':
    case 'datesheets':
      return 'exams';

    case 'promotion':
    case 'bulk-promotion':
      return 'promotion';

    case 'communications':
    case 'communication':
    case 'teacher-chat':
    case 'class-notices':
      return 'communication';

    case 'community-events':
    case 'community':
    case 'school-community':
      return 'community-events';

    case 'school-notices':
    case 'notifications':
      return 'dashboard';

    case 'notify-teachers':
      return 'notify-teachers';

    case 'notify-parents':
      return 'notify-parents';

    case 'notify-students':
      return 'notify-students';

    case 'library':
      return 'library';

    case 'transport-gps':
    case 'transport':
    case 'transport-tracker':
      return 'transport';

    case 'learning':
      return 'learning';

    case 'store':
    case 'school-store':
    case 'shop':
      return 'store';

    default:
      return null;
  }
}
