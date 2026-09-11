from django.db import models


class OrderStatus(models.TextChoices):
    """Lifecycle of an order"""
    NEW = 'new', 'New'
    PAID = 'paid', 'Paid'
    IN_TRANSIT = 'in-transit', 'In transit'


class Customer(models.Model):

    id = models.BigAutoField(primary_key=True)
    email = models.EmailField(unique=True)
    referred_by = models.ForeignKey('self', on_delete=models.SET_NULL, db_column='referred_by_id', null=True, blank=True)
    joined_on = models.DateField(help_text='Signup date')

    class Meta:
        db_table = 'customers'
        ordering = ['-id']
        verbose_name = 'customer'


class Profile(models.Model):

    id = models.UUIDField(primary_key=True)
    customer = models.OneToOneField('Customer', on_delete=models.CASCADE, db_column='customer_id')
    bio = models.TextField(blank=True)
    settings = models.JSONField(null=True)

    class Meta:
        db_table = 'customer_profiles'

    def __str__(self):
        return self.bio[:20]


class Category(models.Model):

    slug = models.CharField(max_length=60, unique=True)
    parent = models.ForeignKey('self', on_delete=models.SET_NULL, db_column='parent_id', null=True, blank=True)

    class Meta:
        db_table = 'categories'


class Product(models.Model):

    sku = models.CharField(max_length=32, unique=True)
    category_slug = models.ForeignKey('Category', on_delete=models.PROTECT, db_column='category_slug', to_field='slug')
    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    weight = models.FloatField(null=True, blank=True)
    stock = models.SmallIntegerField(default=0, db_comment='units on hand')

    class Meta:
        db_table = 'products'
        indexes = [
            models.Index(fields=['price'], name='products_price_idx'),
        ]


class Order(models.Model):

    customer = models.ForeignKey('Customer', on_delete=models.PROTECT, db_column='customer_id', related_name='orders')
    status = models.CharField(max_length=10, choices=OrderStatus.choices, default=OrderStatus.NEW)
    placed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'orders'


class OrderItem(models.Model):

    pk = models.CompositePrimaryKey('order', 'product')
    order = models.ForeignKey('Order', on_delete=models.CASCADE, db_column='order_id')
    product = models.ForeignKey('Product', on_delete=models.DO_NOTHING, db_column='product_id')
    quantity = models.IntegerField(default=1)

    class Meta:
        db_table = 'order_items'


class Review(models.Model):

    product = models.ForeignKey('Product', on_delete=models.CASCADE, db_column='product_id')
    customer = models.ForeignKey('Customer', on_delete=models.SET_DEFAULT, db_column='customer_id')
    rating = models.SmallIntegerField()

    class Meta:
        db_table = 'reviews'
        constraints = [
            models.UniqueConstraint(fields=['product', 'customer'], name='reviews_product_id_customer_id_uniq'),
        ]
