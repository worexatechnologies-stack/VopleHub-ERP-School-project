import logging

from django.conf import settings
from django.core.mail import send_mail
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

logger = logging.getLogger(__name__)


class ContactInquirySerializer(serializers.Serializer):
    name = serializers.CharField(max_length=160, trim_whitespace=True)
    email = serializers.EmailField(max_length=254)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True, trim_whitespace=True)
    schoolName = serializers.CharField(max_length=180, required=False, allow_blank=True, trim_whitespace=True)
    role = serializers.CharField(max_length=100, required=False, allow_blank=True, trim_whitespace=True)
    city = serializers.CharField(max_length=120, required=False, allow_blank=True, trim_whitespace=True)
    message = serializers.CharField(max_length=10000, required=False, allow_blank=True, trim_whitespace=True)


class ContactInquiryView(APIView):
    """Accept public website enquiries and deliver them to the configured inbox."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'contact_inquiry'

    def post(self, request):
        serializer = ContactInquirySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        inquiry = serializer.validated_data

        recipient = settings.CONTACT_INQUIRY_EMAIL
        from_email = settings.DEFAULT_FROM_EMAIL
        if not recipient or not from_email or not settings.EMAIL_HOST:
            logger.error('Website contact enquiry email is not configured.')
            return Response(
                {'detail': 'The contact service is temporarily unavailable. Please call or email us directly.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        school_or_name = ' '.join((inquiry.get('schoolName') or inquiry['name']).splitlines())[:100]
        subject = f'VolpeHub website enquiry — {school_or_name}'
        message = '\n'.join([
            'A new enquiry was submitted through the VolpeHub website.',
            '',
            f"Name: {inquiry['name']}",
            f"Email: {inquiry['email']}",
            f"Phone: {inquiry.get('phone') or 'Not provided'}",
            f"Institution: {inquiry.get('schoolName') or 'Not provided'}",
            f"Role: {inquiry.get('role') or 'Not provided'}",
            f"City / location: {inquiry.get('city') or 'Not provided'}",
            '',
            'What they would like to improve:',
            inquiry.get('message') or 'Not provided',
        ])

        try:
            sent = send_mail(
                subject=subject,
                message=message,
                from_email=from_email,
                recipient_list=[recipient],
                fail_silently=False,
                reply_to=[inquiry['email']],
            )
        except Exception:
            logger.exception('Failed to deliver VolpeHub website enquiry.')
            return Response(
                {'detail': 'We could not send your enquiry right now. Please try again or contact us by phone or email.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if not sent:
            logger.error('The email backend did not accept a VolpeHub website enquiry.')
            return Response(
                {'detail': 'We could not send your enquiry right now. Please try again or contact us by phone or email.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response({'detail': 'Your enquiry has been sent.'}, status=status.HTTP_201_CREATED)
