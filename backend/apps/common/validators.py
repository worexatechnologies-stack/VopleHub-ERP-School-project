"""Content-sniffing and Pillow-based image validation/optimization."""
from io import BytesIO
from pathlib import Path
import warnings
import zipfile

from django.core.exceptions import ValidationError
from PIL import Image, ImageOps, UnidentifiedImageError

BLOCKED_EXTENSIONS = {'.exe', '.sh', '.php', '.js', '.html', '.htm', '.bat', '.cmd', '.ps1'}
SIGNATURES = {
    b'%PDF-': ('application/pdf', {'.pdf'}),
    b'\x89PNG\r\n\x1a\n': ('image/png', {'.png'}),
    b'\xff\xd8\xff': ('image/jpeg', {'.jpg', '.jpeg'}),
}
RASTER_IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/webp'}
MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024
MAX_SOURCE_IMAGE_PIXELS = 20_000_000
MAX_IMAGE_DIMENSION = 1024
MAX_OPTIMIZED_IMAGE_BYTES = 1_500_000
WEBP_QUALITY = 86
MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_CHAT_ATTACHMENT_COUNT = 5
MAX_CHAT_MESSAGE_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_SPREADSHEET_BYTES = 25 * 1024 * 1024


def _detected_type(upload):
    position = upload.tell() if hasattr(upload, 'tell') else 0
    head = upload.read(8192)
    upload.seek(position)
    for signature, result in SIGNATURES.items():
        if head.startswith(signature):
            return result
    if head.startswith(b'RIFF') and head[8:12] == b'WEBP':
        return 'image/webp', {'.webp'}
    text = head.decode('utf-8', errors='ignore').lstrip().lower()
    if text.startswith('<svg') or text.startswith('<?xml') and '<svg' in text:
        if '<script' in text or 'javascript:' in text or ' onload=' in text or ' onerror=' in text:
            raise ValidationError('SVG files may not contain scripts or event handlers.')
        return 'image/svg+xml', {'.svg'}
    raise ValidationError('The uploaded file content is not an allowed document or image format.')


def detected_content_type(upload):
    """Return the content type derived from file bytes, never client metadata."""
    return _detected_type(upload)[0]


def validate_upload(upload, *, allowed_types, max_bytes):
    extension = Path(upload.name).suffix.lower()
    if extension in BLOCKED_EXTENSIONS:
        raise ValidationError('Executable and script file extensions are not allowed.')
    if upload.size > max_bytes:
        raise ValidationError(f'File exceeds the {max_bytes // (1024 * 1024)} MB limit.')
    detected_type, matching_extensions = _detected_type(upload)
    if detected_type not in allowed_types or extension not in matching_extensions:
        raise ValidationError('File extension does not match detected file content.')


def validate_raster_image_upload(upload):
    """Reject spoofed, oversized, malformed, and decompression-bomb images."""
    validate_upload(upload, allowed_types=RASTER_IMAGE_TYPES, max_bytes=MAX_SOURCE_IMAGE_BYTES)
    try:
        upload.seek(0)
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(upload) as source:
                source.verify()
        upload.seek(0)
        with Image.open(upload) as source:
            width, height = source.size
            if width < 1 or height < 1 or width * height > MAX_SOURCE_IMAGE_PIXELS:
                raise ValidationError('Image dimensions are invalid or exceed the 20 megapixel safety limit.')
    except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning, OSError) as exc:
        raise ValidationError('The uploaded image is malformed or unsafe.') from exc
    finally:
        upload.seek(0)


def optimize_raster_image(upload):
    """Return safe, metadata-free WebP bytes, avoiding a second encode when safe."""
    validate_raster_image_upload(upload)
    content_type = detected_content_type(upload)
    upload.seek(0)
    with Image.open(upload) as source:
        source.load()
        metadata_present = any(key in source.info for key in ('exif', 'xmp', 'icc_profile'))
        if (
            content_type == 'image/webp'
            and max(source.size) <= MAX_IMAGE_DIMENSION
            and upload.size <= MAX_OPTIMIZED_IMAGE_BYTES
            and not metadata_present
        ):
            upload.seek(0)
            return upload.read(), 'image/webp', source.size

        image = ImageOps.exif_transpose(source)
        mode = 'RGBA' if 'A' in image.getbands() else 'RGB'
        image = image.convert(mode)
        image.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)

        for quality in (WEBP_QUALITY, 80, 74):
            output = BytesIO()
            image.save(output, format='WEBP', quality=quality, method=6)
            payload = output.getvalue()
            if len(payload) <= MAX_OPTIMIZED_IMAGE_BYTES or quality == 74:
                return payload, 'image/webp', image.size
    raise ValidationError('Image optimization failed.')


def validate_student_document(upload):
    validate_upload(upload, allowed_types={'application/pdf', 'image/jpeg', 'image/png'}, max_bytes=5 * 1024 * 1024)
    # A scanned identity document is still an image and must receive the same
    # Pillow safety checks as profile images (including decompression bombs).
    if detected_content_type(upload).startswith('image/'):
        validate_raster_image_upload(upload)


def validate_school_logo(upload):
    validate_raster_image_upload(upload)


def validate_student_photo(upload):
    validate_raster_image_upload(upload)


def validate_chat_attachment(upload):
    """Allow only verified raster images and PDFs in direct messages."""
    validate_upload(
        upload,
        allowed_types={'application/pdf', *RASTER_IMAGE_TYPES},
        max_bytes=MAX_CHAT_ATTACHMENT_BYTES,
    )
    if detected_content_type(upload).startswith('image/'):
        validate_raster_image_upload(upload)


def validate_enrollment_photo(upload):
    validate_upload(upload, allowed_types=RASTER_IMAGE_TYPES, max_bytes=5 * 1024 * 1024)
    validate_raster_image_upload(upload)


def validate_enrollment_document(upload):
    validate_upload(
        upload,
        allowed_types={'application/pdf', 'image/jpeg', 'image/png'},
        max_bytes=15 * 1024 * 1024,
    )
    if detected_content_type(upload).startswith('image/'):
        validate_raster_image_upload(upload)


def validate_spreadsheet_upload(upload):
    """Validate a CSV or OpenXML spreadsheet before parsing it."""
    extension = Path(upload.name).suffix.lower()
    if upload.size > MAX_SPREADSHEET_BYTES:
        raise ValidationError('Spreadsheet exceeds the 25 MB limit.')
    if extension == '.csv':
        upload.seek(0)
        sample = upload.read(min(upload.size, 8192))
        upload.seek(0)
        if b'\x00' in sample:
            raise ValidationError('CSV files must contain plain text data.')
        return
    if extension not in {'.xlsx', '.xlsm', '.xltx'}:
        raise ValidationError('Upload a CSV or modern Excel (.xlsx) spreadsheet.')

    upload.seek(0)
    signature = upload.read(4)
    upload.seek(0)
    if signature != b'PK\x03\x04':
        raise ValidationError('The spreadsheet content does not match its file extension.')

    try:
        with zipfile.ZipFile(upload) as archive:
            entries = archive.infolist()
            expanded_size = sum(entry.file_size for entry in entries)
            names = {entry.filename for entry in entries}
            if len(entries) > 10_000 or expanded_size > 100 * 1024 * 1024:
                raise ValidationError('Spreadsheet archive expands beyond safe limits.')
            if '[Content_Types].xml' not in names or 'xl/workbook.xml' not in names:
                raise ValidationError('The uploaded Excel file is invalid or incomplete.')
            if any(name.lower().endswith('vbaproject.bin') for name in names):
                raise ValidationError('Macro-enabled spreadsheets are not accepted.')
    except zipfile.BadZipFile as exc:
        raise ValidationError('The uploaded Excel file is corrupt.') from exc
    finally:
        upload.seek(0)
