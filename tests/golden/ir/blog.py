from django.db import models


class PostStatus(models.TextChoices):
    DRAFT = 'draft', 'Draft'
    PUBLISHED = 'published', 'Published'
    ARCHIVED = 'archived', 'Archived'


class User(models.Model):

    """Registered users"""

    username = models.CharField(max_length=150, unique=True)
    email = models.CharField(max_length=254, unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'users'


class Post(models.Model):

    author = models.ForeignKey('User', on_delete=models.CASCADE, db_column='author_id')
    title = models.CharField(max_length=200)
    body = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=9, choices=PostStatus.choices, default=PostStatus.DRAFT)
    published_at = models.DateTimeField(null=True, blank=True)
    tags = models.ManyToManyField('Tag')

    class Meta:
        db_table = 'posts'
        indexes = [
            models.Index(fields=['author', 'published_at']),
        ]


class Tag(models.Model):

    name = models.CharField(max_length=50, unique=True)

    class Meta:
        db_table = 'tags'


class Comment(models.Model):

    post = models.ForeignKey('Post', on_delete=models.CASCADE, db_column='post_id')
    user = models.ForeignKey('User', on_delete=models.CASCADE, db_column='user_id')
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'comments'
