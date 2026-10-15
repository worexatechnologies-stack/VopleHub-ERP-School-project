"""Management command to migrate legacy PostgreSQL bytea blobs to S3/MinIO/FileSystem storage."""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.common.storage import (
    save_file,
    student_photo_key,
    student_document_key,
    teacher_photo_key,
    teacher_document_key,
    enrollment_photo_key,
    enrollment_document_key,
)
from apps.sis.models import Student, StudentDocument, EnrollmentApplication
from apps.staff.models import Teacher, TeacherDocument


class Command(BaseCommand):
    help = 'Migrates binary blobs from PostgreSQL bytea columns to object storage (S3/MinIO/FileSystem)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--purge-db-bytes',
            action='store_true',
            help='Clear bytea columns in PostgreSQL after successfully saving to object storage to reclaim DB disk space',
        )
        parser.add_argument(
            '--batch-size',
            type=int,
            default=100,
            help='Batch size for processing records',
        )

    def handle(self, *args, **options):
        purge = options.get('purge_db_bytes', False)
        batch_size = options.get('batch_size', 100)

        self.stdout.write(self.style.NOTICE(
            f"Starting binary migration to object storage (purge_db_bytes={purge}, batch_size={batch_size})..."
        ))

        migrated_students = self._migrate_student_photos(purge, batch_size)
        migrated_teachers = self._migrate_teacher_photos(purge, batch_size)
        migrated_student_docs = self._migrate_student_documents(purge, batch_size)
        migrated_teacher_docs = self._migrate_teacher_documents(purge, batch_size)
        migrated_apps = self._migrate_enrollment_applications(purge, batch_size)

        self.stdout.write(self.style.SUCCESS(
            f"\nMigration complete!\n"
            f"  - Student photos migrated: {migrated_students}\n"
            f"  - Teacher photos migrated: {migrated_teachers}\n"
            f"  - Student documents migrated: {migrated_student_docs}\n"
            f"  - Teacher documents migrated: {migrated_teacher_docs}\n"
            f"  - Enrollment applications migrated: {migrated_apps}\n"
        ))

    def _migrate_student_photos(self, purge: bool, batch_size: int) -> int:
        count = 0
        qs = Student.objects.exclude(photo_data__isnull=True).filter(photo_key='')
        for student in qs.iterator(chunk_size=batch_size):
            raw_bytes = bytes(student.photo_data)
            if not raw_bytes:
                continue
            key = student_photo_key(student.school_id, student.pk)
            save_file(raw_bytes, key)
            student.photo_key = key
            update_fields = ['photo_key']
            if purge:
                student.photo_data = None
                update_fields.append('photo_data')
            student.save(update_fields=update_fields)
            count += 1
        return count

    def _migrate_teacher_photos(self, purge: bool, batch_size: int) -> int:
        count = 0
        qs = Teacher.objects.exclude(photo_data__isnull=True).filter(photo_key='')
        for teacher in qs.iterator(chunk_size=batch_size):
            raw_bytes = bytes(teacher.photo_data)
            if not raw_bytes:
                continue
            key = teacher_photo_key(teacher.school_id, teacher.pk)
            save_file(raw_bytes, key)
            teacher.photo_key = key
            update_fields = ['photo_key']
            if purge:
                teacher.photo_data = None
                update_fields.append('photo_data')
            teacher.save(update_fields=update_fields)
            count += 1
        return count

    def _migrate_student_documents(self, purge: bool, batch_size: int) -> int:
        count = 0
        qs = StudentDocument.objects.exclude(file_data__isnull=True).filter(file_key='').select_related('student')
        for doc in qs.iterator(chunk_size=batch_size):
            raw_bytes = bytes(doc.file_data)
            if not raw_bytes:
                continue
            key = student_document_key(doc.student.school_id, doc.student_id, doc.file_name or doc.name)
            save_file(raw_bytes, key)
            doc.file_key = key
            doc.file_size = len(raw_bytes)
            update_fields = ['file_key', 'file_size']
            if purge:
                doc.file_data = None
                update_fields.append('file_data')
            doc.save(update_fields=update_fields)
            count += 1
        return count

    def _migrate_teacher_documents(self, purge: bool, batch_size: int) -> int:
        count = 0
        qs = TeacherDocument.objects.exclude(file_data__isnull=True).filter(file_key='').select_related('teacher')
        for doc in qs.iterator(chunk_size=batch_size):
            raw_bytes = bytes(doc.file_data)
            if not raw_bytes:
                continue
            key = teacher_document_key(doc.teacher.school_id, doc.teacher_id, doc.file_name or doc.name)
            save_file(raw_bytes, key)
            doc.file_key = key
            doc.file_size = len(raw_bytes)
            update_fields = ['file_key', 'file_size']
            if purge:
                doc.file_data = None
                update_fields.append('file_data')
            doc.save(update_fields=update_fields)
            count += 1
        return count

    def _migrate_enrollment_applications(self, purge: bool, batch_size: int) -> int:
        count = 0
        qs = EnrollmentApplication.objects.all()
        for app in qs.iterator(chunk_size=batch_size):
            updated = False
            update_fields = []
            if app.photo_data and not app.photo_key:
                raw_bytes = bytes(app.photo_data)
                key = enrollment_photo_key(app.school_id, app.application_no)
                save_file(raw_bytes, key)
                app.photo_key = key
                update_fields.append('photo_key')
                if purge:
                    app.photo_data = None
                    update_fields.append('photo_data')
                updated = True
            if app.document_data and not app.document_key:
                raw_bytes = bytes(app.document_data)
                key = enrollment_document_key(app.school_id, app.application_no, app.document_name or 'document')
                save_file(raw_bytes, key)
                app.document_key = key
                app.document_size = len(raw_bytes)
                update_fields.extend(['document_key', 'document_size'])
                if purge:
                    app.document_data = None
                    update_fields.append('document_data')
                updated = True
            if updated:
                app.save(update_fields=update_fields)
                count += 1
        return count
