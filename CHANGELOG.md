# Changelog

## Unreleased

- Added tenant-scoped academic year, class, and section APIs with cross-school access tests.
- Rebranded product-facing text as Volpehub Education; database and deployment identifiers remain `volpehub_education`.
- Standardized the browser access-token key on `school_erp_api_token` and added a one-time silent refresh/retry flow for expired access tokens.
- Added a reusable tenant-scoped DRF viewset and applied tenant-safe student and teacher querysets.
- Added a regression test preventing cross-school student read and update access by guessed ID.
- Backend integration tests require either a running Docker daemon or a local Python environment with the backend requirements installed.
