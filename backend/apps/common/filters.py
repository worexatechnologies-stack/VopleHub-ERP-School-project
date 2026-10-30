from rest_framework.filters import OrderingFilter


class StableOrderingFilter(OrderingFilter):
    """Add a primary-key tie-breaker so paged results do not shuffle."""

    def filter_queryset(self, request, queryset, view):
        ordered = super().filter_queryset(request, queryset, view)
        ordering = list(ordered.query.order_by or ())
        if not ordering:
            ordering = list(getattr(view, 'ordering', None) or ())
        if not any(str(field).lstrip('-') in {'pk', 'id'} for field in ordering):
            ordering.append('pk')
        return ordered.order_by(*ordering) if ordering else ordered
