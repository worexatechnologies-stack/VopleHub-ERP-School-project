from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework.permissions import AllowAny
from rest_framework.routers import DefaultRouter
from apps.accounts.views import (
    LoginView,
    LogoutView,
    MeView,
    PresenceHeartbeatView,
    RefreshView,
    SchoolAdminCreateView,
    SchoolAdminDeleteView,
    SchoolAdminPasswordSetView,
    SchoolAdminLifecycleView,
    UserListView,
    ChangePasswordView,
    ResetCredentialsView,
    CredentialVaultViewSet,
)
from apps.schools.views import SchoolViewSet
from apps.sis.views import (
    StudentViewSet,
    StudentDocumentCollectionView,
    StudentDocumentDownloadView,
    SchoolDocumentQueueView,
    EnrollmentLinkViewSet,
    EnrollmentApplicationViewSet,
    VerifyEnrollmentLinkView,
    SubmitEnrollmentApplicationView,
)
from apps.staff.views import StaffSalaryPaymentViewSet, TeacherDocumentCollectionView, TeacherDocumentDownloadView, TeacherViewSet
from apps.notifications.views import DeviceTokenView, NotificationAcknowledgeView, NotificationClearAllView, NotificationDecisionView, NotificationListView, NotificationReadView, SchoolToTeachersView, TeacherToAdminView, TeacherToParentsView, TeacherToStudentsView
from apps.exams.views import ExamViewSet, ExamScheduleViewSet, StudentResultsView
from apps.attendance.views import AttendanceViewSet
from apps.academics.views import AcademicYearViewSet, ClassViewSet, SectionViewSet, SubjectViewSet, HomeworkViewSet
from apps.timetable.views import TimetableSlotViewSet
from apps.finance.views import FeeStructureViewSet, FeeQuarterViewSet, StudentFeeRecordViewSet, FeePaymentViewSet
from apps.chat.views import (
    AttachmentDownloadView,
    ChatClearAllView,
    ChatbotInteractionListView,
    ChatContactsListView,
    ConversationDetailView,
    ConversationListView,
    ConversationMessagesView,
    ConversationReadView,
    MessageDetailView,
    ParentChatbotAskView,
    StartConversationView,
    UnreadCountView,
)
from apps.community.views import SchoolEventViewSet, EventRegistrationViewSet, CommunityPostViewSet
from apps.common.views import ExportJobViewSet

class PublicAPIRootRouter(DefaultRouter):
    """Expose the discovery endpoint without exposing protected resources."""

    class APIRootView(DefaultRouter.APIRootView):
        permission_classes = [AllowAny]


router = PublicAPIRootRouter()
router.register('schools', SchoolViewSet, basename='school')
router.register('students', StudentViewSet, basename='student')
router.register('teachers', TeacherViewSet, basename='teacher')
router.register('staff-salaries', StaffSalaryPaymentViewSet, basename='staff-salary')
router.register('attendance', AttendanceViewSet, basename='attendance')
router.register('academic-years', AcademicYearViewSet, basename='academic-year')
router.register('classes', ClassViewSet, basename='class')
router.register('sections', SectionViewSet, basename='section')
router.register('subjects', SubjectViewSet, basename='subject')
router.register('homework', HomeworkViewSet, basename='homework')
router.register('exams', ExamViewSet, basename='exam')
router.register('exam-schedules', ExamScheduleViewSet, basename='exam-schedule')
router.register('timetable-slots', TimetableSlotViewSet, basename='timetable-slot')
router.register('fee-structures', FeeStructureViewSet, basename='fee-structure')
router.register('fee-quarters', FeeQuarterViewSet, basename='fee-quarter')
router.register('fee-records', StudentFeeRecordViewSet, basename='fee-record')
router.register('fee-payments', FeePaymentViewSet, basename='fee-payment')
router.register('events', SchoolEventViewSet, basename='event')
router.register('event-registrations', EventRegistrationViewSet, basename='event-registration')
router.register('community-posts', CommunityPostViewSet, basename='community-post')
router.register('enrollment-links', EnrollmentLinkViewSet, basename='enrollment-link')
router.register('enrollment-applications', EnrollmentApplicationViewSet, basename='enrollment-application')
router.register('credential-vault', CredentialVaultViewSet, basename='credential-vault')
router.register('exports', ExportJobViewSet, basename='export')


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/enrollment/verify/', VerifyEnrollmentLinkView.as_view()),
    path('api/v1/enrollment/submit/', SubmitEnrollmentApplicationView.as_view()),
    path('api/v1/auth/login/', LoginView.as_view()),
    path('api/v1/auth/presence/heartbeat/', PresenceHeartbeatView.as_view()),
    path('api/v1/auth/school-admins/', SchoolAdminCreateView.as_view()),
    path('api/v1/auth/school-admins/<int:user_id>/delete/', SchoolAdminDeleteView.as_view()),
    path('api/v1/auth/school-admins/<int:user_id>/set-password/', SchoolAdminPasswordSetView.as_view()),
    path('api/v1/auth/school-admins/<int:user_id>/<str:action>/', SchoolAdminLifecycleView.as_view()),
    path('api/v1/auth/users/<int:user_id>/reset-credentials/', ResetCredentialsView.as_view()),
    path('api/v1/auth/change-password/', ChangePasswordView.as_view()),
    path('api/v1/auth/users/', UserListView.as_view()),
    path('api/v1/auth/refresh/', RefreshView.as_view()),
    path('api/v1/auth/logout/', LogoutView.as_view()),
    path('api/v1/auth/me/', MeView.as_view()),
    path('api/v1/chat/contacts/', ChatContactsListView.as_view()),
    path('api/v1/chat/conversations/', ConversationListView.as_view()),
    path('api/v1/chat/conversations/start/', StartConversationView.as_view()),
    path('api/v1/chat/conversations/<int:conversation_id>/', ConversationDetailView.as_view()),
    path('api/v1/chat/conversations/<int:conversation_id>/messages/', ConversationMessagesView.as_view()),
    path('api/v1/chat/conversations/<int:conversation_id>/read/', ConversationReadView.as_view()),
    path('api/v1/chat/unread-count/', UnreadCountView.as_view()),
    path('api/v1/chat/clear-all/', ChatClearAllView.as_view()),
    path('api/v1/conversations/', ConversationListView.as_view()),
    path('api/v1/conversations/start/', StartConversationView.as_view()),
    path('api/v1/conversations/<int:conversation_id>/', ConversationDetailView.as_view()),
    path('api/v1/conversations/<int:conversation_id>/messages/', ConversationMessagesView.as_view()),
    path('api/v1/conversations/<int:conversation_id>/read/', ConversationReadView.as_view()),
    path('api/v1/messages/<int:message_id>/', MessageDetailView.as_view()),
    path('api/v1/unread-count/', UnreadCountView.as_view()),
    path('api/v1/attachments/<str:attachment_id>/download/', AttachmentDownloadView.as_view()),
    path('api/v1/chatbot/ask/', ParentChatbotAskView.as_view()),
    path('api/v1/chatbot/interactions/', ChatbotInteractionListView.as_view()),
    path('api/v1/notifications/', NotificationListView.as_view()),
    path('api/v1/notifications/clear-all/', NotificationClearAllView.as_view()),
    path('api/v1/notifications/devices/', DeviceTokenView.as_view()),
    path('api/v1/notifications/<int:notification_id>/read/', NotificationReadView.as_view()),
    path('api/v1/notifications/<int:notification_id>/decision/', NotificationDecisionView.as_view()),
    path('api/v1/notifications/<int:notification_id>/acknowledge/', NotificationAcknowledgeView.as_view()),
    path('api/v1/notifications/school-to-teachers/', SchoolToTeachersView.as_view()),
    path('api/v1/notifications/teacher-to-admin/', TeacherToAdminView.as_view()),
    path('api/v1/notifications/teacher-to-parents/', TeacherToParentsView.as_view()),
    path('api/v1/notifications/teacher-to-students/', TeacherToStudentsView.as_view()),
    path('api/v1/students/<int:student_id>/results/', StudentResultsView.as_view()),
    path('api/v1/', include(router.urls)),
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema')),
]
urlpatterns.insert(-4, path('api/v1/school/documents/queue/', SchoolDocumentQueueView.as_view()))
urlpatterns.insert(-4, path('api/v1/documents/queue/', SchoolDocumentQueueView.as_view()))
urlpatterns.insert(-4, path('api/v1/students/<int:student_id>/documents/', StudentDocumentCollectionView.as_view()))
urlpatterns.insert(-4, path('api/v1/students/<int:student_id>/documents/<int:doc_id>/', StudentDocumentDownloadView.as_view({'get': 'retrieve', 'delete': 'destroy', 'patch': 'partial_update'})))
urlpatterns.insert(-4, path('api/v1/students/me/documents/', StudentDocumentCollectionView.as_view()))
urlpatterns.insert(-4, path('api/v1/students/me/documents/<int:doc_id>/', StudentDocumentDownloadView.as_view({'get': 'retrieve', 'delete': 'destroy', 'patch': 'partial_update'})))
urlpatterns.insert(-4, path('api/v1/teachers/<int:teacher_id>/documents/', TeacherDocumentCollectionView.as_view()))
urlpatterns.insert(-4, path('api/v1/teachers/<int:teacher_id>/documents/<int:doc_id>/', TeacherDocumentDownloadView.as_view({'get': 'retrieve', 'delete': 'destroy', 'patch': 'partial_update'})))
urlpatterns.insert(-4, path('api/v1/teachers/me/documents/', TeacherDocumentCollectionView.as_view()))
urlpatterns.insert(-4, path('api/v1/teachers/me/documents/<int:doc_id>/', TeacherDocumentDownloadView.as_view({'get': 'retrieve', 'delete': 'destroy', 'patch': 'partial_update'})))
# Defensive fallback routes in case legacy/cached clients include redundant /api/v1 prefixes
urlpatterns.insert(-4, path('api/v1/api/v1/students/<int:student_id>/documents/<int:doc_id>/', StudentDocumentDownloadView.as_view({'get': 'retrieve', 'delete': 'destroy', 'patch': 'partial_update'})))
urlpatterns.insert(-4, path('api/v1/api/v1/teachers/<int:teacher_id>/documents/<int:doc_id>/', TeacherDocumentDownloadView.as_view({'get': 'retrieve', 'delete': 'destroy', 'patch': 'partial_update'})))

from django.conf import settings
from django.conf.urls.static import static

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

