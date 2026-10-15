import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
django.setup()

from apps.sis import views as sis_views, serializers as sis_serializers, models as sis_models
from apps.staff import views as staff_views, serializers as staff_serializers, models as staff_models
from apps.academics import views as aca_views, serializers as aca_serializers, models as aca_models
from apps.attendance import views as att_views, serializers as att_serializers, models as att_models
from apps.finance import views as fin_views, serializers as fin_serializers, models as fin_models
from apps.exams import views as exm_views, serializers as exm_serializers, models as exm_models
from apps.timetable import views as tt_views, serializers as tt_serializers, models as tt_models
from apps.notifications import views as notif_views, serializers as notif_serializers, models as notif_models
from apps.chat import views as chat_views, serializers as chat_serializers, models as chat_models

modules = [
    ('sis', sis_views, sis_serializers, sis_models),
    ('staff', staff_views, staff_serializers, staff_models),
    ('academics', aca_views, aca_serializers, aca_models),
    ('attendance', att_views, att_serializers, att_models),
    ('finance', fin_views, fin_serializers, fin_models),
    ('exams', exm_views, exm_serializers, exm_models),
    ('timetable', tt_views, tt_serializers, tt_models),
    ('notifications', notif_views, notif_serializers, notif_models),
    ('chat', chat_views, chat_serializers, chat_models),
]

for app_name, v_mod, s_mod, m_mod in modules:
    print(f"\n=== APP: {app_name} ===")
    for attr in dir(v_mod):
        obj = getattr(v_mod, attr)
        if isinstance(obj, type) and hasattr(obj, 'queryset') and obj.queryset is not None:
            qs = obj.queryset
            pag = getattr(obj, 'pagination_class', 'DEFAULT')
            serializer = getattr(obj, 'serializer_class', None)
            ser_name = getattr(serializer, '__name__', 'None')
            print(f"  ViewSet: {attr}")
            print(f"    Pagination: {pag}")
            print(f"    Serializer: {ser_name}")
            print(f"    QS Model: {qs.model.__name__}")
            print(f"    select_related: {qs.query.select_related}")
            print(f"    prefetch: {qs._prefetch_related_lookups}")

            # Check serializer fields
            if serializer and hasattr(serializer, '_declared_fields'):
                for f_name, f_obj in serializer._declared_fields.items():
                    if f_obj.__class__.__name__ == 'SerializerMethodField':
                        print(f"      [SerializerMethodField] {f_name}")
                    elif 'Serializer' in f_obj.__class__.__name__:
                        print(f"      [NestedSerializer] {f_name} ({f_obj.__class__.__name__})")
