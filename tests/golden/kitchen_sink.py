from django.db import models


class OrderStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    PAID = 'paid', 'Paid'
    ON_HOLD = 'on hold', 'On hold'
    CANCELLED = 'cancelled', 'Cancelled'


class Role(models.TextChoices):
    ADMIN = 'admin', 'Admin'
    MEMBER = 'member', 'Member'


class User(models.Model):

    """People who can log in"""

    email = models.CharField(max_length=254, unique=True, help_text='Login identifier')
    display_name = models.CharField(max_length=100, null=True, blank=True, default='anonymous')
    role = models.CharField(max_length=6, choices=Role.choices, default=Role.MEMBER)
    balance = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    bio = models.TextField(null=True, blank=True, help_text='Multi-line\nbio with \'quotes\' and a back\\slash')
    created_at = models.DateTimeField(auto_now_add=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'users'


class Session(models.Model):

    token = models.UUIDField(primary_key=True)
    user = models.ForeignKey('User', on_delete=models.CASCADE, db_column='user_id')
    expires_at = models.DateTimeField()

    class Meta:
        db_table = 'sessions'
        indexes = [
            models.Index(fields=['user', 'expires_at'], name='sessions_user_expiry'),
        ]


class Profile(models.Model):

    user = models.OneToOneField('User', on_delete=models.CASCADE, db_column='user_id', unique=True)
    website = models.CharField(max_length=2048, null=True, blank=True)

    class Meta:
        db_table = 'profiles'


class Order(models.Model):

    user = models.ForeignKey('User', on_delete=models.PROTECT, db_column='user_id')
    status = models.CharField(max_length=9, choices=OrderStatus.choices, default=OrderStatus.PENDING)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    placed_at = models.DateTimeField(auto_now_add=True)
    tags = models.ManyToManyField('Tag')

    class Meta:
        db_table = 'orders'
        indexes = [
            models.Index(fields=['status']),
        ]
        constraints = [
            models.UniqueConstraint(fields=['user', 'placed_at'], name='orders_user_id_placed_at_uniq'),
        ]


class OrderLine(models.Model):

    pk = models.CompositePrimaryKey('order', 'line_no')
    order = models.ForeignKey('Order', on_delete=models.CASCADE, db_column='order_id')
    line_no = models.IntegerField()
    sku = models.CharField(max_length=64)
    qty = models.IntegerField(default=1)

    class Meta:
        db_table = 'order_lines'
        indexes = [
            models.Index(fields=['sku'], name='order_lines_sku_idx'),
        ]


class Tag(models.Model):

    label = models.CharField(max_length=50, unique=True)

    class Meta:
        db_table = 'tags'


class OrderLineNote(models.Model):

    order_id = models.IntegerField()
    line_no = models.IntegerField()
    note_text = models.TextField(db_column='note text')

    class Meta:
        db_table = 'order line notes'
