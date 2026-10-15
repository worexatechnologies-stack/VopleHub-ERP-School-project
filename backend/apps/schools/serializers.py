from rest_framework import serializers
from apps.common.validators import optimize_raster_image, validate_school_logo
from .models import School

class SchoolSerializer(serializers.ModelSerializer):
    schoolName = serializers.CharField(source='name')
    subdomain = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    logoImageUrl = serializers.SerializerMethodField(read_only=True)
    logoFile = serializers.FileField(write_only=True, required=False, allow_null=True)
    logoIcon = serializers.CharField(source='icon', required=False, default='School')
    primaryColor = serializers.CharField(source='primary_color', required=False, default='#6366f1')
    secondaryColor = serializers.CharField(source='secondary_color', required=False, default='#10b981')
    theme = serializers.CharField(required=False, default='glass-academy')
    isDemo = serializers.BooleanField(source='is_demo', read_only=True)
    class Meta:
        model = School
        fields = ['id', 'schoolName', 'code', 'subdomain', 'logoIcon', 'logoImageUrl', 'logoFile', 'primaryColor', 'secondaryColor', 'theme', 'is_active', 'isDemo']

    def get_logoImageUrl(self, obj) -> str | None:
        if not obj.logo_data:
            return None
        return f'/api/v1/schools/{obj.pk}/logo/'

    def validate_logoFile(self, value):
        validate_school_logo(value)
        return value

    @staticmethod
    def _store_logo(instance, logo_file):
        if logo_file is None:
            instance.logo_data = None
            instance.logo_content_type = ''
        else:
            instance.logo_data, instance.logo_content_type, _ = optimize_raster_image(logo_file)
        instance.save(update_fields=['logo_data', 'logo_content_type'])

    def create(self, validated_data):
        logo_file = validated_data.pop('logoFile', serializers.empty)
        instance = super().create(validated_data)
        if logo_file is not serializers.empty:
            self._store_logo(instance, logo_file)
        return instance

    def update(self, instance, validated_data):
        logo_file = validated_data.pop('logoFile', serializers.empty)
        instance = super().update(instance, validated_data)
        if logo_file is not serializers.empty:
            self._store_logo(instance, logo_file)
        return instance

    def validate(self, data):
        code = data.get('code')
        subdomain = data.get('subdomain')
        name = data.get('name')
        instance_id = self.instance.id if self.instance else None

        if code and School.objects.filter(code=code).exclude(id=instance_id).exists():
            raise serializers.ValidationError({'code': f'School code "{code}" is already in use by another school.'})
        if subdomain and School.objects.filter(subdomain=subdomain).exclude(id=instance_id).exists():
            raise serializers.ValidationError({'subdomain': f'Subdomain "{subdomain}" is already in use by another school.'})
        if name and School.objects.filter(name__iexact=name).exclude(id=instance_id).exists():
            raise serializers.ValidationError({'schoolName': f'A school named "{name}" already exists.'})
        return data
