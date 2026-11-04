import io
import uuid
from decimal import Decimal
from django.core.management.base import BaseCommand
from PIL import Image, ImageDraw, ImageFont

from apps.schools.models import School
from apps.store.models import StoreProduct


def _generate_product_image(product_type: str, title: str, subtitle: str, color_theme: str) -> bytes:
    """Generate a clean, high-resolution 600x600 product illustration image with badges and branding."""
    width, height = 600, 600
    
    # Theme palette
    themes = {
        'navy': {
            'bg_top': (238, 242, 255), 'bg_bot': (224, 231, 255),
            'card_bg': (255, 255, 255), 'primary': (30, 58, 138),
            'accent': (79, 70, 229), 'badge_bg': (224, 231, 255), 'badge_text': (49, 46, 129),
        },
        'emerald': {
            'bg_top': (236, 253, 245), 'bg_bot': (209, 250, 229),
            'card_bg': (255, 255, 255), 'primary': (6, 78, 59),
            'accent': (16, 185, 129), 'badge_bg': (209, 250, 229), 'badge_text': (6, 95, 70),
        },
        'amber': {
            'bg_top': (255, 251, 235), 'bg_bot': (254, 243, 199),
            'card_bg': (255, 255, 255), 'primary': (120, 53, 15),
            'accent': (217, 119, 6), 'badge_bg': (254, 243, 199), 'badge_text': (146, 64, 14),
        },
        'sky': {
            'bg_top': (240, 249, 255), 'bg_bot': (224, 242, 254),
            'card_bg': (255, 255, 255), 'primary': (12, 74, 110),
            'accent': (14, 165, 233), 'badge_bg': (224, 242, 254), 'badge_text': (3, 105, 161),
        },
        'purple': {
            'bg_top': (250, 245, 255), 'bg_bot': (243, 232, 255),
            'card_bg': (255, 255, 255), 'primary': (88, 28, 135),
            'accent': (168, 85, 247), 'badge_bg': (243, 232, 255), 'badge_text': (107, 33, 168),
        },
        'rose': {
            'bg_top': (255, 241, 242), 'bg_bot': (255, 228, 230),
            'card_bg': (255, 255, 255), 'primary': (136, 19, 55),
            'accent': (244, 63, 94), 'badge_bg': (255, 228, 230), 'badge_text': (159, 18, 57),
        },
        'teal': {
            'bg_top': (240, 253, 250), 'bg_bot': (204, 251, 241),
            'card_bg': (255, 255, 255), 'primary': (19, 78, 74),
            'accent': (20, 184, 166), 'badge_bg': (204, 251, 241), 'badge_text': (15, 118, 110),
        },
    }
    palette = themes.get(color_theme, themes['navy'])

    img = Image.new('RGB', (width, height), color=palette['bg_top'])
    draw = ImageDraw.Draw(img)

    # Vertical gradient effect
    for y in range(height):
        ratio = y / height
        r = int(palette['bg_top'][0] * (1 - ratio) + palette['bg_bot'][0] * ratio)
        g = int(palette['bg_top'][1] * (1 - ratio) + palette['bg_bot'][1] * ratio)
        b = int(palette['bg_top'][2] * (1 - ratio) + palette['bg_bot'][2] * ratio)
        draw.line([(0, y), (width, y)], fill=(r, g, b))

    # Inner modern card container
    card_margin = 35
    draw.rounded_rectangle(
        [(card_margin, card_margin), (width - card_margin, height - card_margin)],
        radius=28,
        fill=palette['card_bg'],
        outline=palette['accent'],
        width=3,
    )

    # Top Pill Badge
    badge_w, badge_h = 240, 36
    badge_x = (width - badge_w) // 2
    badge_y = card_margin + 20
    draw.rounded_rectangle(
        [(badge_x, badge_y), (badge_x + badge_w, badge_y + badge_h)],
        radius=18,
        fill=palette['badge_bg'],
        outline=palette['accent'],
        width=1,
    )
    badge_label = "OFFICIAL SCHOOL GEAR"
    draw.text((badge_x + 35, badge_y + 10), badge_label, fill=palette['badge_text'])

    # Illustration area in center (y: 110 to 390)
    cx, cy = width // 2, 250

    if product_type == 'uniform':
        # Draw formal uniform shirt with collar, buttons, and school pocket
        shirt_color = palette['primary']
        draw.rounded_rectangle([(cx - 100, cy - 80), (cx + 100, cy + 110)], radius=18, fill=shirt_color)
        # Sleeves
        draw.polygon([(cx - 100, cy - 70), (cx - 155, cy - 10), (cx - 120, cy + 15), (cx - 95, cy - 30)], fill=shirt_color)
        draw.polygon([(cx + 100, cy - 70), (cx + 155, cy - 10), (cx + 120, cy + 15), (cx + 95, cy - 30)], fill=shirt_color)
        # White / contrasting collar
        draw.polygon([(cx, cy - 50), (cx - 50, cy - 85), (cx, cy - 85)], fill=(255, 255, 255))
        draw.polygon([(cx, cy - 50), (cx + 50, cy - 85), (cx, cy - 85)], fill=(255, 255, 255))
        # Pocket & gold school crest
        draw.rounded_rectangle([(cx + 30, cy - 20), (cx + 70, cy + 25)], radius=6, fill=palette['primary'], outline=(255, 255, 255), width=2)
        draw.ellipse([(cx + 45, cy - 8), (cx + 55, cy + 2)], fill=(234, 179, 8))
        # Buttons
        for by in range(cy - 30, cy + 90, 30):
            draw.ellipse([(cx - 5, by), (cx + 5, by + 10)], fill=(255, 255, 255))

    elif product_type == 'blazer':
        # Draw elegant school blazer with lapels & brass buttons
        blazer_color = palette['primary']
        draw.rounded_rectangle([(cx - 110, cy - 80), (cx + 110, cy + 115)], radius=16, fill=blazer_color)
        # Lapels
        draw.polygon([(cx - 70, cy - 80), (cx - 30, cy + 10), (cx, cy - 30), (cx - 20, cy - 80)], fill=(15, 23, 42))
        draw.polygon([(cx + 70, cy - 80), (cx + 30, cy + 10), (cx, cy - 30), (cx + 20, cy - 80)], fill=(15, 23, 42))
        # Shirt and tie peek
        draw.polygon([(cx - 20, cy - 80), (cx + 20, cy - 80), (cx, cy - 35)], fill=(255, 255, 255))
        draw.polygon([(cx - 8, cy - 70), (cx + 8, cy - 70), (cx + 5, cy - 10), (cx, cy), (cx - 5, cy - 10)], fill=(225, 29, 72))
        # Brass buttons
        draw.ellipse([(cx + 15, cy + 20), (cx + 27, cy + 32)], fill=(234, 179, 8))
        draw.ellipse([(cx + 15, cy + 55), (cx + 27, cy + 67)], fill=(234, 179, 8))
        # Pocket badge
        draw.rounded_rectangle([(cx - 85, cy - 15), (cx - 45, cy + 25)], radius=6, fill=(15, 23, 42), outline=(234, 179, 8), width=2)

    elif product_type == 'sports':
        # Athletic Jersey & Shorts
        draw.rounded_rectangle([(cx - 95, cy - 80), (cx + 95, cy + 60)], radius=16, fill=palette['primary'])
        # Sport racing stripes
        draw.rectangle([(cx - 15, cy - 80), (cx + 15, cy + 60)], fill=(255, 255, 255))
        draw.rectangle([(cx - 7, cy - 80), (cx + 7, cy + 60)], fill=palette['accent'])
        # Sport number "10"
        draw.text((cx - 16, cy - 15), "10", fill=(255, 255, 255))
        # Shorts
        draw.rounded_rectangle([(cx - 75, cy + 65), (cx + 75, cy + 125)], radius=10, fill=palette['primary'])
        draw.line([(cx, cy + 85), (cx, cy + 125)], fill=(255, 255, 255), width=4)

    elif product_type == 'books':
        # Stack of 3 colorful curriculum books with ribbon bookmark
        book_colors = [(225, 29, 72), (14, 165, 233), (16, 185, 129)]
        for i, bcolor in enumerate(book_colors):
            bx = cx - 120 + (i * 10)
            by = cy + 50 - (i * 50)
            draw.rounded_rectangle([(bx, by), (bx + 230, by + 40)], radius=8, fill=bcolor)
            # Pages
            draw.rectangle([(bx + 20, by + 6), (bx + 225, by + 34)], fill=(254, 252, 232))
            draw.rectangle([(bx, by), (bx + 20, by + 40)], fill=bcolor)
        # Ribbon bookmark
        draw.polygon([(cx + 40, cy - 45), (cx + 55, cy - 45), (cx + 55, cy + 40), (cx + 47, cy + 30), (cx + 40, cy + 40)], fill=(234, 179, 8))

    elif product_type == 'kit':
        # Academic Kit Box with books, notebook and pencil
        draw.rounded_rectangle([(cx - 130, cy - 50), (cx + 130, cy + 115)], radius=20, fill=palette['primary'])
        draw.rounded_rectangle([(cx - 115, cy - 35), (cx + 115, cy + 100)], radius=12, fill=(255, 255, 255))
        # Books and supplies inside
        draw.rounded_rectangle([(cx - 95, cy - 15), (cx - 20, cy + 80)], radius=8, fill=(225, 29, 72))
        draw.rounded_rectangle([(cx - 10, cy - 15), (cx + 65, cy + 80)], radius=8, fill=(14, 165, 233))
        # Ruler & pencil
        draw.rectangle([(cx + 75, cy - 25), (cx + 90, cy + 80)], fill=(234, 179, 8))
        draw.text((cx - 75, cy + 20), "ALL-IN-ONE", fill=(255, 255, 255))

    elif product_type == 'backpack':
        # Ergonomic School Bag
        draw.rounded_rectangle([(cx - 90, cy - 80), (cx + 90, cy + 110)], radius=36, fill=palette['primary'])
        # Front pocket
        draw.rounded_rectangle([(cx - 65, cy), (cx + 65, cy + 90)], radius=18, fill=palette['accent'])
        # School Logo Circle
        draw.ellipse([(cx - 22, cy + 20), (cx + 22, cy + 64)], fill=(255, 255, 255))
        draw.ellipse([(cx - 12, cy + 30), (cx + 12, cy + 54)], fill=palette['primary'])
        # Top handle & straps
        draw.arc([(cx - 40, cy - 105), (cx + 40, cy - 65)], start=180, end=0, fill=palette['primary'], width=10)

    elif product_type == 'stationery':
        # Pencil Box, Compass & Colors
        draw.rounded_rectangle([(cx - 120, cy - 30), (cx + 120, cy + 85)], radius=16, fill=palette['primary'])
        # Inner Tray
        draw.rounded_rectangle([(cx - 110, cy - 20), (cx + 110, cy + 75)], radius=12, fill=(241, 245, 249))
        # Colored Pencils
        pencil_colors = [(225, 29, 72), (234, 179, 8), (16, 185, 129), (14, 165, 233), (168, 85, 247)]
        for idx, pcolor in enumerate(pencil_colors):
            px = cx - 85 + (idx * 35)
            draw.rectangle([(px, cy - 5), (px + 18, cy + 65)], fill=pcolor)
            draw.polygon([(px, cy - 5), (px + 18, cy - 5), (px + 9, cy - 20)], fill=(254, 215, 170))

    elif product_type == 'bottle':
        # Stainless Steel Insulated Flask
        draw.rounded_rectangle([(cx - 50, cy - 60), (cx + 50, cy + 120)], radius=22, fill=palette['primary'])
        # Cap & grip band
        draw.rounded_rectangle([(cx - 35, cy - 90), (cx + 35, cy - 60)], radius=10, fill=(15, 23, 42))
        draw.rectangle([(cx - 50, cy + 10), (cx + 50, cy + 40)], fill=palette['accent'])
        # Measurement icon or water droplet
        draw.ellipse([(cx - 12, cy + 55), (cx + 12, cy + 85)], fill=(255, 255, 255))

    else:
        # Default gear / socks / accessories
        draw.rounded_rectangle([(cx - 80, cy - 50), (cx + 80, cy + 90)], radius=24, fill=palette['primary'])
        draw.ellipse([(cx - 30, cy - 10), (cx + 30, cy + 50)], fill=palette['accent'])

    # Title & Subtitle banner at bottom of card
    title_box_top = height - card_margin - 95
    draw.line([(card_margin + 20, title_box_top), (width - card_margin - 20, title_box_top)], fill=(226, 232, 240), width=2)
    
    # Title centered
    draw.text((card_margin + 25, title_box_top + 16), title[:42], fill=palette['primary'])
    # Subtitle centered
    draw.text((card_margin + 25, title_box_top + 46), subtitle[:55], fill=(100, 116, 139))

    out_io = io.BytesIO()
    img.save(out_io, format='PNG', optimize=True)
    return out_io.getvalue()


class Command(BaseCommand):
    help = 'Seed realistic dummy school store products with high-resolution self-hosted graphics.'

    def handle(self, *args, **options):
        schools = list(School.objects.all())
        if not schools:
            self.stdout.write(self.style.ERROR('No schools found. Please ensure at least one school exists.'))
            return

        self.stdout.write(f'Seeding store products for {len(schools)} school(s)...')

        for school in schools:
            self.stdout.write(f'\n-> Processing School: {school.name} (Code: {school.code})')

            # Catalog definition
            catalog = [
                {
                    'name': 'Daily Classic School Uniform Set',
                    'category': 'Uniforms',
                    'uniform_type': 'Daily uniform',
                    'target_classes': [str(i) for i in range(1, 13)],
                    'price': Decimal('850.00'),
                    'description': 'Official school daily uniform set. Crafted from premium breathable cotton-blend fabric, wrinkle-resistant and pre-shrunk for comfortable all-day school wear.',
                    'img_type': 'uniform',
                    'color_theme': 'navy',
                    'badge': 'PREMIUM COTTON-BLEND',
                    'variants': [
                        ('Size 26 (Age 5-6)', 30),
                        ('Size 28 (Age 7-8)', 45),
                        ('Size 30 (Age 9-10)', 50),
                        ('Size 32 (Age 11-12)', 35),
                        ('Size 34 (Class 8-9)', 25),
                        ('Size 36 (Senior)', 15),
                    ],
                },
                {
                    'name': 'Winter Wool-Blend Crest Blazer',
                    'category': 'Uniforms',
                    'uniform_type': 'Winter blazer / sweater',
                    'target_classes': [str(i) for i in range(5, 13)],
                    'price': Decimal('1450.00'),
                    'description': 'Tailored winter blazer with embroidered school monogram, embossed gold-tone buttons, internal pockets, and thermal insulating lining.',
                    'img_type': 'blazer',
                    'color_theme': 'navy',
                    'badge': 'THERMAL WOOL-BLEND',
                    'variants': [
                        ('Size 30 (Class 5-6)', 18),
                        ('Size 32 (Class 7-8)', 24),
                        ('Size 34 (Class 9-10)', 20),
                        ('Size 36 (Class 11-12)', 12),
                    ],
                },
                {
                    'name': 'House Sports Tracksuit & Jersey Set',
                    'category': 'Sports',
                    'uniform_type': 'Sports uniform',
                    'target_classes': [str(i) for i in range(1, 13)],
                    'price': Decimal('680.00'),
                    'description': 'Microfiber moisture-wicking sports jersey and jogger tracksuit with reinforced knees and school athletics insignia. Suitable for all 4 school houses.',
                    'img_type': 'sports',
                    'color_theme': 'rose',
                    'badge': 'QUICK-DRY ATHLETIC',
                    'variants': [
                        ('Size 28 (Junior)', 25),
                        ('Size 30 (Sub-Junior)', 30),
                        ('Size 32 (Junior Boys/Girls)', 30),
                        ('Size 34 (Senior)', 20),
                    ],
                },
                {
                    'name': 'Class 8 Complete Academic Kit',
                    'category': 'Academic Kits & Bundles',
                    'uniform_type': '',
                    'target_classes': ['8'],
                    'price': Decimal('2150.00'),
                    'description': 'Everything needed for Class 8: 7 NCERT textbooks (Math, Science, Social Science, English, Hindi, Sanskrit, ICT), 12 classmate long notebooks, geometry set, lab record book, and student academic planner.',
                    'img_type': 'kit',
                    'color_theme': 'amber',
                    'badge': 'FULL YEAR BUNDLE',
                    'stock': 65,
                },
                {
                    'name': 'Class 6 Standard Book & Notebook Bundle',
                    'category': 'Academic Kits & Bundles',
                    'uniform_type': '',
                    'target_classes': ['6'],
                    'price': Decimal('1850.00'),
                    'description': 'Complete Class 6 starter pack: CBSE/NCERT curriculum textbooks, 10 ruled long notebooks, 2 drawing books, map workbook, and customized student diary.',
                    'img_type': 'books',
                    'color_theme': 'amber',
                    'badge': 'CURRICULUM APPROVED',
                    'stock': 40,
                },
                {
                    'name': 'Student Essential Stationery Kit',
                    'category': 'Stationery',
                    'uniform_type': '',
                    'target_classes': [str(i) for i in range(1, 9)],
                    'price': Decimal('320.00'),
                    'description': 'Complete stationery set containing 12 HB writing pencils, dust-free erasers, sharpener with canister, 30cm shatterproof steel scale, glue stick, and pencil case.',
                    'img_type': 'stationery',
                    'color_theme': 'sky',
                    'badge': 'NON-TOXIC & CHILD-SAFE',
                    'stock': 85,
                },
                {
                    'name': 'Senior Science Lab Apron & Safety Goggles',
                    'category': 'Uniforms',
                    'uniform_type': 'Lab coat / Apron',
                    'target_classes': ['9', '10', '11', '12'],
                    'price': Decimal('420.00'),
                    'description': '100% thick white cotton laboratory coat with chest and waist utility pockets. Comes bundled with scratch-resistant anti-fog eye protection goggles.',
                    'img_type': 'uniform',
                    'color_theme': 'teal',
                    'badge': 'LAB SAFETY COMPLIANT',
                    'variants': [
                        ('Size 32 (Class 9)', 30),
                        ('Size 34 (Class 10)', 35),
                        ('Size 36 (Class 11-12)', 25),
                    ],
                },
                {
                    'name': 'Ergonomic Spine-Support School Backpack',
                    'category': 'Merchandise',
                    'uniform_type': '',
                    'target_classes': [str(i) for i in range(1, 13)],
                    'price': Decimal('890.00'),
                    'description': 'Spine-aligned orthopaedic backpack designed to reduce heavy book strain. Features 3 zippered compartments, bottle pockets, night-glow reflective strips, and water-repellent nylon.',
                    'img_type': 'backpack',
                    'color_theme': 'purple',
                    'badge': 'WATERPROOF & ORTHOPAEDIC',
                    'stock': 55,
                },
                {
                    'name': 'Insulated Stainless Steel Hydration Flask & Bento Set',
                    'category': 'Merchandise',
                    'uniform_type': '',
                    'target_classes': [str(i) for i in range(1, 11)],
                    'price': Decimal('540.00'),
                    'description': 'Food-grade 304 stainless steel 750ml insulated thermos (keeps beverages cold 18 hrs / warm 12 hrs) with 3-compartment leakproof clip-lock bento lunch container.',
                    'img_type': 'bottle',
                    'color_theme': 'teal',
                    'badge': 'BPA-FREE FOOD-GRADE',
                    'stock': 48,
                },
                {
                    'name': 'School Crest Cushioned Socks & Belt Pack',
                    'category': 'Uniforms',
                    'uniform_type': 'Socks',
                    'target_classes': [str(i) for i in range(1, 13)],
                    'price': Decimal('240.00'),
                    'description': 'Combo pack of 3 pairs of cushioned antimicrobial cotton ribbed socks with school house stripes, paired with an adjustable woven brass-buckle uniform belt.',
                    'img_type': 'uniform',
                    'color_theme': 'navy',
                    'badge': '3-PAIR VALUE PACK',
                    'variants': [
                        ('Size S (Class 1-4)', 60),
                        ('Size M (Class 5-8)', 70),
                        ('Size L (Class 9-12)', 40),
                    ],
                },
            ]

            created_count = 0
            for item in catalog:
                # Check if product with same name already exists in this school
                if StoreProduct.objects.filter(school=school, name=item['name']).exists():
                    self.stdout.write(f"   - Already exists: {item['name']}")
                    continue

                image_bytes = _generate_product_image(
                    product_type=item['img_type'],
                    title=item['name'],
                    subtitle=item['badge'],
                    color_theme=item['color_theme'],
                )

                if 'variants' in item:
                    # Multi-size variant product
                    group_id = uuid.uuid4()
                    first_variant = True
                    for size_label, qty in item['variants']:
                        sku = f"ST-{uuid.uuid4().hex[:12].upper()}"
                        product = StoreProduct.objects.create(
                            school=school,
                            name=item['name'],
                            sku=sku,
                            variant_group=group_id,
                            description=item['description'],
                            category=item['category'],
                            uniform_type=item['uniform_type'],
                            target_classes=item['target_classes'],
                            size_label=size_label,
                            price=item['price'],
                            stock_quantity=qty,
                            is_active=True,
                            image_data=image_bytes if first_variant else None,
                            image_content_type='image/png' if first_variant else '',
                        )
                        first_variant = False
                    created_count += 1
                    self.stdout.write(self.style.SUCCESS(f"   + Created variant group: {item['name']} ({len(item['variants'])} sizes)"))
                else:
                    # Single product without size variants
                    sku = f"ST-{uuid.uuid4().hex[:12].upper()}"
                    product = StoreProduct.objects.create(
                        school=school,
                        name=item['name'],
                        sku=sku,
                        description=item['description'],
                        category=item['category'],
                        uniform_type=item['uniform_type'],
                        target_classes=item['target_classes'],
                        price=item['price'],
                        stock_quantity=item.get('stock', 50),
                        is_active=True,
                        image_data=image_bytes,
                        image_content_type='image/png',
                    )
                    created_count += 1
                    self.stdout.write(self.style.SUCCESS(f"   + Created product: {item['name']} (Stock: {item.get('stock', 50)})"))

            self.stdout.write(self.style.SUCCESS(f"Finished {school.name}: {created_count} product group(s) added."))

        self.stdout.write(self.style.SUCCESS('\nAll schools seeded with dummy store products and graphics successfully!'))
