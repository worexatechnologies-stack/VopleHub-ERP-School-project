from rest_framework.pagination import PageNumberPagination


class AdminListPagination(PageNumberPagination):
    """Bounded page sizes for admin directories and ledgers."""

    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 200
