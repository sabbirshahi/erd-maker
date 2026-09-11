from django.db import models


class ProductsStatus(models.TextChoices):
    OUT_OF_STOCK = 'out_of_stock', 'Out of stock'
    IN_STOCK = 'in_stock', 'In stock'
    RUNNING_LOW = 'running_low', 'Running low'


class Country(models.Model):

    code = models.IntegerField(primary_key=True)
    name = models.CharField(max_length=255, null=True, blank=True)
    continent_name = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        db_table = 'countries'


class Order(models.Model):

    """Customer orders"""

    id = models.IntegerField(primary_key=True)
    user_id = models.IntegerField(unique=True)
    status = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.CharField(max_length=255, null=True, blank=True, help_text='When order created')

    class Meta:
        db_table = 'orders'


class User(models.Model):

    full_name = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(null=True, blank=True)
    country_code = models.ForeignKey('Country', on_delete=models.SET_NULL, db_column='country_code', null=True, blank=True)

    class Meta:
        db_table = 'users'


class Merchant(models.Model):

    country_code = models.ForeignKey('Country', on_delete=models.CASCADE, db_column='country_code', null=True, blank=True)
    merchant_name = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.CharField(max_length=255, db_column='created at', null=True, blank=True)
    admin = models.ForeignKey('User', on_delete=models.CASCADE, db_column='admin_id', null=True, blank=True)

    class Meta:
        db_table = 'merchants'


class Product(models.Model):

    id = models.IntegerField(primary_key=True)
    name = models.CharField(max_length=255, null=True, blank=True)
    merchant = models.ForeignKey('Merchant', on_delete=models.CASCADE, db_column='merchant_id')
    price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True, default=0)
    status = models.CharField(max_length=12, choices=ProductsStatus.choices, null=True, blank=True, default=ProductsStatus.IN_STOCK)
    created_at = models.DateTimeField(null=True, blank=True, auto_now_add=True)

    class Meta:
        db_table = 'products'
        indexes = [
            models.Index(fields=['merchant', 'status'], name='product_status'),
        ]
        constraints = [
            models.UniqueConstraint(fields=['id'], name='products_id_uniq'),
        ]


class OrderItem(models.Model):

    pk = models.CompositePrimaryKey('order', 'product')
    order = models.ForeignKey('Order', on_delete=models.CASCADE, db_column='order_id')
    product = models.ForeignKey('Product', on_delete=models.CASCADE, db_column='product_id')
    quantity = models.IntegerField(null=True, blank=True, default=1)

    class Meta:
        db_table = 'order_items'
