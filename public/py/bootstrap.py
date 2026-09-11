"""
Demo bootstrap: configure Django once inside Pyodide. OWNER: worker-5 (demo).

Runs a single time per worker. The models module is rebuilt per schema version by
runtime.py (`build`), using a fresh app label (`demo_v<n>`) because Django's app
registry cannot unregister models (plan D10).
"""
import os
import sys

# Pyodide runs Python on the main thread of the worker; Django's async-safety
# guard would otherwise refuse ORM calls made while an event loop is running.
os.environ.setdefault('DJANGO_ALLOW_ASYNC_UNSAFE', 'true')

import django  # noqa: E402
from django.conf import settings  # noqa: E402

APP_ROOT = os.environ.get('DEMO_APP_ROOT', '/app')

if not settings.configured:
    settings.configure(
        DEBUG=True,  # needed so connection.queries records executed SQL
        SECRET_KEY='demo',
        USE_TZ=True,
        TIME_ZONE='UTC',
        INSTALLED_APPS=[],
        DEFAULT_AUTO_FIELD='django.db.models.AutoField',
        DATABASES={
            'default': {
                'ENGINE': 'django.db.backends.sqlite3',
                'NAME': ':memory:',
            }
        },
    )
    django.setup()

os.makedirs(APP_ROOT, exist_ok=True)
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

DJANGO_VERSION = django.get_version()
PYTHON_VERSION = sys.version.split()[0]
