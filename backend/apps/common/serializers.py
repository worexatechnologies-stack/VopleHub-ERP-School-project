from rest_framework import serializers
from .models import ExportJob


class ExportJobSerializer(serializers.ModelSerializer):
    percent_complete = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ExportJob
        fields = [
            'id', 'resource_type', 'file_format', 'filters',
            'status', 'total_records', 'processed_records',
            'percent_complete', 'file_size', 'error_message',
            'created_by', 'created_by_name', 'created_at', 'completed_at',
        ]
        read_only_fields = [
            'id', 'status', 'total_records', 'processed_records',
            'percent_complete', 'file_size', 'error_message',
            'created_by', 'created_by_name', 'created_at', 'completed_at',
        ]

    def get_percent_complete(self, obj) -> float:
        if obj.status == ExportJob.Status.COMPLETED:
            return 100.0
        if not obj.total_records or obj.total_records <= 0:
            return 0.0
        return round((obj.processed_records / obj.total_records) * 100, 1)

    def get_created_by_name(self, obj) -> str:
        if not obj.created_by:
            return ''
        return obj.created_by.get_full_name() or obj.created_by.email
