from rest_framework import serializers
from apps.accounts.models import User
from apps.sis.models import Student
from .models import Conversation, ConversationParticipant, DirectMessage, MessageAttachment


class StudentContextSerializer(serializers.ModelSerializer):
    className = serializers.CharField(source='class_name', read_only=True)
    rollNo = serializers.IntegerField(source='roll_no', read_only=True)
    admissionNo = serializers.CharField(source='admission_no', read_only=True)

    class Meta:
        model = Student
        fields = ['id', 'name', 'className', 'section', 'rollNo', 'admissionNo']


class MessageAttachmentSerializer(serializers.ModelSerializer):
    originalName = serializers.CharField(source='original_name', read_only=True)
    contentType = serializers.CharField(source='content_type', read_only=True)
    fileSize = serializers.IntegerField(source='file_size', read_only=True)
    downloadUrl = serializers.SerializerMethodField()

    class Meta:
        model = MessageAttachment
        fields = ['id', 'originalName', 'contentType', 'fileSize', 'downloadUrl']

    def get_downloadUrl(self, obj) -> str:
        return f"/api/v1/attachments/{obj.id}/download/"


class UserParticipantSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='get_full_name', read_only=True)
    role = serializers.CharField(source='frontend_role', read_only=True)
    isOnline = serializers.BooleanField(source='is_online_computed', read_only=True)
    assignedSections = serializers.SerializerMethodField()
    subjects = serializers.SerializerMethodField()
    childMappings = serializers.SerializerMethodField()
    students = serializers.SerializerMethodField()
    studentSummary = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'name', 'role', 'email', 'isOnline',
            'assignedSections', 'subjects', 'childMappings', 'students', 'studentSummary'
        ]

    def get_assignedSections(self, obj) -> list[str]:
        if obj.role == User.Role.TEACHER:
            teacher = getattr(obj, 'teacher_profile', None)
            if teacher:
                secs = list(teacher.assigned_sections or [])
                for s in teacher.sections.select_related('class_room').all():
                    label = f"{s.class_room.name} - Sec {s.name}" if s.class_room else f"Sec {s.name}"
                    if label not in secs:
                        secs.append(label)
                for ta in teacher.teaching_assignments.select_related('section__class_room').all():
                    label = f"{ta.section.class_room.name} - Sec {ta.section.name}" if ta.section.class_room else f"Sec {ta.section.name}"
                    if label not in secs:
                        secs.append(label)
                return secs
        return []

    def get_subjects(self, obj) -> list[str]:
        if obj.role == User.Role.TEACHER:
            teacher = getattr(obj, 'teacher_profile', None)
            if teacher:
                subs = list(teacher.subjects or [])
                for s in teacher.subject_records.all():
                    if s.name not in subs:
                        subs.append(s.name)
                for ta in teacher.teaching_assignments.select_related('subject').all():
                    if ta.subject and ta.subject.name not in subs:
                        subs.append(ta.subject.name)
                return subs
        return []

    def get_childMappings(self, obj) -> list[dict]:
        request = self.context.get('request')
        if not request or not request.user or request.user.role != User.Role.PARENT or obj.role != User.Role.TEACHER:
            return []
        parent_profile = getattr(request.user, 'parent_profile', None)
        teacher = getattr(obj, 'teacher_profile', None)
        if not parent_profile or not teacher:
            return []

        mappings = []
        for st in parent_profile.students.filter(school=request.user.school, status='Active'):
            s_class = (st.class_name or '').strip().lower()
            s_sec = (st.section or '').strip().lower()
            s_sec_id = st.section_record_id
            is_match = False
            matched_subs = set()

            for ta in teacher.teaching_assignments.select_related('section__class_room', 'subject').all():
                ta_class = (ta.section.class_room.name or '').strip().lower() if ta.section.class_room else ''
                ta_sec = (ta.section.name or '').strip().lower() if ta.section else ''
                if (s_sec_id and ta.section_id == s_sec_id) or (ta_sec == s_sec and (not ta_class or ta_class == s_class or s_class in ta_class)):
                    is_match = True
                    if ta.subject:
                        matched_subs.add(ta.subject.name)

            for sec in teacher.sections.select_related('class_room').all():
                sec_class = (sec.class_room.name or '').strip().lower() if sec.class_room else ''
                sec_name = (sec.name or '').strip().lower()
                if (s_sec_id and sec.id == s_sec_id) or (sec_name == s_sec and (not sec_class or sec_class == s_class)):
                    is_match = True

            if not is_match and teacher.assigned_sections:
                for asec in teacher.assigned_sections:
                    if s_class in asec.lower() or s_sec in asec.lower():
                        is_match = True

            if is_match:
                subs = list(matched_subs) if matched_subs else (teacher.subjects or [])
                mappings.append({
                    'studentId': st.id,
                    'studentName': st.name,
                    'className': st.class_name,
                    'sectionName': st.section,
                    'subjects': subs,
                })
        return mappings

    def get_students(self, obj) -> list[dict]:
        if obj.role == User.Role.PARENT:
            profile = getattr(obj, 'parent_profile', None)
            if profile:
                return [
                    {
                        'id': s.id,
                        'name': s.name,
                        'className': s.class_name,
                        'section': s.section,
                        'rollNo': s.roll_no,
                        'admissionNo': s.admission_no,
                    }
                    for s in profile.students.filter(status='Active')
                ]
        return []

    def get_studentSummary(self, obj) -> str:
        if obj.role == User.Role.PARENT:
            students = self.get_students(obj)
            if students:
                summaries = [f"{s['name']} ({s['className']} - Sec {s['section']}, Roll #{s['rollNo']})" for s in students]
                return f"Parent of {', '.join(summaries)}"
        return ''


class DirectMessageSerializer(serializers.ModelSerializer):
    uuid = serializers.UUIDField(read_only=True)
    conversationId = serializers.IntegerField(source='conversation_id', read_only=True)
    senderId = serializers.IntegerField(source='sender_id', read_only=True)
    senderName = serializers.SerializerMethodField()
    recipientId = serializers.IntegerField(source='recipient_id', read_only=True)
    recipientName = serializers.SerializerMethodField()
    isMe = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    readAt = serializers.DateTimeField(source='read_at', read_only=True)
    messageType = serializers.CharField(source='message_type', read_only=True)
    clientKey = serializers.CharField(source='client_idempotency_key', read_only=True)
    replyToId = serializers.IntegerField(source='reply_to_id', read_only=True)
    editedAt = serializers.DateTimeField(source='edited_at', read_only=True)
    isDeleted = serializers.BooleanField(source='is_deleted', read_only=True)
    attachments = MessageAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = DirectMessage
        fields = [
            'id',
            'uuid',
            'conversationId',
            'senderId',
            'senderName',
            'recipientId',
            'recipientName',
            'isMe',
            'body',
            'messageType',
            'clientKey',
            'replyToId',
            'editedAt',
            'isDeleted',
            'attachments',
            'createdAt',
            'readAt',
        ]

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        if instance.is_deleted:
            ret['body'] = 'This message was deleted.'
        return ret

    def get_senderName(self, obj) -> str:
        if obj.sender:
            return obj.sender.get_full_name() or obj.sender.username or obj.sender.email
        return 'Unknown'

    def get_recipientName(self, obj) -> str:
        if obj.recipient:
            return obj.recipient.get_full_name() or obj.recipient.username or obj.recipient.email
        return 'Unknown'

    def get_isMe(self, obj) -> bool:
        request = self.context.get('request')
        if not request or not request.user:
            return False
        return obj.sender_id == request.user.id


class ConversationSerializer(serializers.ModelSerializer):
    uuid = serializers.UUIDField(read_only=True)
    conversationType = serializers.CharField(source='conversation_type', read_only=True)
    status = serializers.CharField(read_only=True)
    otherParticipant = serializers.SerializerMethodField()
    student = StudentContextSerializer(read_only=True)
    lastMessage = serializers.SerializerMethodField()
    unreadCount = serializers.SerializerMethodField()
    updatedAt = serializers.DateTimeField(source='updated_at', read_only=True)
    isMuted = serializers.SerializerMethodField()
    isArchived = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = [
            'id',
            'uuid',
            'conversationType',
            'status',
            'otherParticipant',
            'student',
            'lastMessage',
            'unreadCount',
            'updatedAt',
            'isMuted',
            'isArchived',
        ]

    def get_otherParticipant(self, obj) -> dict:
        request = self.context.get('request')
        if not request or not request.user:
            return {}
        other_user = obj.get_other_participant(request.user)
        return UserParticipantSerializer(other_user, context=self.context).data

    def get_lastMessage(self, obj) -> dict | None:
        request = self.context.get('request')
        # Optimized: check prefetched messages first
        if hasattr(obj, '_prefetched_objects_cache') and 'messages' in obj._prefetched_objects_cache:
            all_msgs = obj.messages.all()
            if all_msgs:
                return DirectMessageSerializer(all_msgs[0], context=self.context).data
            return None

        last_msg = obj.messages.select_related('sender', 'recipient').order_by('-created_at').first()
        if not last_msg:
            return None
        return DirectMessageSerializer(last_msg, context=self.context).data

    def get_unreadCount(self, obj) -> int:
        request = self.context.get('request')
        if not request or not request.user:
            return 0
        user_id = request.user.id

        # Use prefetched messages if available
        if hasattr(obj, '_prefetched_objects_cache') and 'messages' in obj._prefetched_objects_cache:
            return sum(1 for m in obj.messages.all() if m.recipient_id == user_id and m.read_at is None and not m.is_deleted)

        return obj.messages.filter(recipient_id=user_id, read_at__isnull=True, is_deleted=False).count()

    def get_isMuted(self, obj) -> bool:
        request = self.context.get('request')
        if not request or not request.user:
            return False
        p = obj.participants.filter(user_id=request.user.id).first()
        return bool(p and p.is_muted)

    def get_isArchived(self, obj) -> bool:
        request = self.context.get('request')
        if not request or not request.user:
            return False
        p = obj.participants.filter(user_id=request.user.id).first()
        return bool(p and p.is_archived)
