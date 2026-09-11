"""
Demo runtime: rebuild the models app, create tables in an in-memory SQLite DB, seed fake
rows, and run raw SQL / ORM snippets. OWNER: worker-5 (demo).

Every public function returns a JSON string so the worker can post it without any
Pyodide proxy conversion. Requires bootstrap.py to have run first.
"""
import ast
import contextlib
import datetime as _dt
import decimal
import importlib
import io
import json
import os
import sys
import time
import traceback
import uuid

from django.apps import apps
from django.core import checks as django_checks
from django.db import connection
from django.db.backends.base.base import BaseDatabaseWrapper
from django.db.models import Avg, Count, F, Max, Min, Prefetch, Q, Sum
from django.db.models.query import QuerySet
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

APP_ROOT = os.environ.get('DEMO_APP_ROOT', '/app')
ROW_CAP = 1000

_version = 0
_app_label = None
_last_build = None  # (table_order, dataset)

# Optional JS progress callback registered by the worker: progress(stage, pct, message).
_progress = None


def set_progress_callback(cb):
    global _progress
    _progress = cb


def _report(stage, pct, message):
    if _progress is not None:
        try:
            _progress(stage, pct, message)
        except Exception:  # pragma: no cover - never let UI plumbing break a build
            pass


# ---------------------------------------------------------------- JSON safety

def _json_safe(v):
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, decimal.Decimal):
        return str(v)
    if isinstance(v, (_dt.datetime, _dt.date, _dt.time)):
        return v.isoformat(sep=' ') if isinstance(v, _dt.datetime) else v.isoformat()
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, (bytes, bytearray, memoryview)):
        return bytes(v).hex()
    if isinstance(v, dict):
        return {str(k): _json_safe(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, set, frozenset)):
        return [_json_safe(x) for x in v]
    return repr(v)


def _dumps(obj):
    return json.dumps(_json_safe(obj))


def _error(exc_type, exc, tb, user_only=False):
    """Format a traceback. With `user_only`, keep only frames from the user's snippet
    (`<orm>`) so Django internals do not bury the actual error."""
    frames = traceback.extract_tb(tb)
    if user_only:
        frames = [f for f in frames if f.filename == '<orm>']
    text = ''.join(traceback.format_list(frames))
    msg = ''.join(traceback.format_exception_only(exc_type, exc))
    return 'Traceback (most recent call last):\n' + text + msg if text else msg


# ---------------------------------------------------------------- app registry

def _models_for(label):
    return list(apps.get_app_config(label).get_models(include_auto_created=False))


def _ordered_models(label, table_order):
    models = _models_for(label)
    pos = {name: i for i, name in enumerate(table_order or [])}
    models.sort(key=lambda m: pos.get(m._meta.db_table, len(pos)))
    return models


def _fresh_connection():
    """Drop the in-memory DB. Django skips the real close for ':memory:' so force it."""
    if connection.connection is not None:
        BaseDatabaseWrapper.close(connection)
    connection.queries_log.clear()


def _quote(name):
    return connection.ops.quote_name(name)


def _create_tables(models):
    with connection.schema_editor() as editor:
        for i, m in enumerate(models):
            _report('tables', int(100 * i / max(1, len(models))), 'Creating table %s' % m._meta.db_table)
            # create_model also creates auto-created M2M through tables of `m`.
            editor.create_model(m)


def _seed(models, dataset):
    by_table = {m._meta.db_table: m for m in models}
    total = 0
    tables = dataset.get('tables') or []
    joins = dataset.get('joins') or []
    steps = max(1, len(tables) + len(joins))
    step = 0
    with connection.constraint_checks_disabled():
        with connection.cursor() as cur:
            for t in tables:
                step += 1
                name = t['name']
                cols = t['columns']
                rows = t['rows']
                _report('seed', int(100 * step / steps), 'Seeding %s (%d rows)' % (name, len(rows)))
                if name not in by_table or not rows or not cols:
                    continue
                sql = 'INSERT INTO %s (%s) VALUES (%s)' % (
                    _quote(name),
                    ', '.join(_quote(c) for c in cols),
                    ', '.join(['%s'] * len(cols)),
                )
                cur.executemany(sql, [list(r) for r in rows])
                total += len(rows)
            for j in joins:
                step += 1
                total += _seed_join(cur, models, j)
    return total


def _find_m2m(models, from_table, to_table):
    """Locate the auto-created through table for `<>` ref between two db_tables."""
    for m in models:
        for f in m._meta.local_many_to_many:
            through = f.remote_field.through
            if not through._meta.auto_created:
                continue
            src = m._meta.db_table
            dst = f.related_model._meta.db_table
            if src == from_table and dst == to_table:
                return through._meta.db_table, f.m2m_column_name(), f.m2m_reverse_name(), False
            if src == to_table and dst == from_table:
                return through._meta.db_table, f.m2m_column_name(), f.m2m_reverse_name(), True
    return None


def _seed_join(cur, models, join):
    rows = join.get('rows') or []
    if not rows:
        return 0
    found = _find_m2m(models, join['fromTable'], join['toTable'])
    if found is None:
        return 0
    table, src_col, dst_col, swapped = found
    _report('seed', None, 'Seeding %s (%d rows)' % (table, len(rows)))
    sql = 'INSERT OR IGNORE INTO %s (%s, %s) VALUES (%%s, %%s)' % (_quote(table), _quote(src_col), _quote(dst_col))
    params = [[b, a] if swapped else [a, b] for a, b in rows]
    cur.executemany(sql, params)
    return len(rows)


def _fk_violations():
    with connection.cursor() as cur:
        cur.execute('PRAGMA foreign_key_check')
        return len(cur.fetchall())


def _run_checks(label):
    """Django system checks for the demo app (acceptance criterion 5). Silenced messages dropped."""
    try:
        app_config = apps.get_app_config(label)
        messages = django_checks.run_checks(app_configs=[app_config], include_deployment_checks=False)
    except Exception as exc:  # checks themselves must never break a build
        return [{'id': 'demo.E000', 'level': 'ERROR', 'msg': 'System checks could not run: %r' % (exc,), 'obj': None}]
    out = []
    for m in messages:
        if m.is_silenced():
            continue
        obj = m.obj
        if obj is not None:
            try:
                obj = '%s.%s' % (obj._meta.label, obj.name) if hasattr(obj, 'name') and hasattr(obj, '_meta') else str(obj)
            except Exception:
                obj = repr(obj)
        out.append({
            'id': m.id,
            'level': _level_name(m.level),
            'msg': m.msg + ((' ' + m.hint) if m.hint else ''),
            'obj': obj,
        })
    return out


def _level_name(level):
    for name in ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'):
        if getattr(django_checks, name, None) == level:
            return name
    return str(level)


def _create_and_seed(label, table_order, dataset):
    _fresh_connection()
    models = _ordered_models(label, table_order)
    _create_tables(models)
    rows = _seed(models, dataset)
    return models, rows


def build(models_py, table_order, dataset):
    """Register `models_py` under a fresh app label, create tables, seed rows."""
    global _version, _app_label, _last_build
    started = time.time()
    if isinstance(table_order, str):
        table_order = json.loads(table_order)
    if isinstance(dataset, str):
        dataset = json.loads(dataset)
    try:
        _version += 1
        label = 'demo_v%d' % _version
        pkg_dir = os.path.join(APP_ROOT, label)
        os.makedirs(pkg_dir, exist_ok=True)
        with open(os.path.join(pkg_dir, '__init__.py'), 'w') as fh:
            fh.write('')
        with open(os.path.join(pkg_dir, 'models.py'), 'w') as fh:
            fh.write(models_py)
        importlib.invalidate_caches()
        _report('tables', 0, 'Registering models (%s)' % label)
        try:
            apps.set_installed_apps([label])
        except Exception:
            # A broken models.py leaves the registry half-populated and not ready;
            # roll back to the previous app so the panel (and the next build) keep working.
            apps.unset_installed_apps()
            raise
        apps.clear_cache()
        _app_label = label
        _last_build = (table_order, dataset)
        models, rows = _create_and_seed(label, table_order, dataset)
        violations = _fk_violations()
        _report('tables', 100, 'Running Django system checks')
        check_messages = _run_checks(label)
        _report('ready', 100, 'Ready')
        return _dumps({
            'ok': True,
            'appLabel': label,
            'version': _version,
            'tables': [m._meta.db_table for m in models],
            'models': [m.__name__ for m in models],
            'rows': rows,
            'fkViolations': violations,
            'checks': check_messages,
            'ms': int((time.time() - started) * 1000),
        })
    except Exception:
        return _dumps({'ok': False, 'error': _error(*sys.exc_info())})


def reset(dataset=None):
    """Recreate the tables of the current app and reseed (new dataset or the last one)."""
    global _last_build
    started = time.time()
    if _app_label is None or _last_build is None:
        return _dumps({'ok': False, 'error': 'Nothing built yet'})
    if isinstance(dataset, str):
        dataset = json.loads(dataset)
    table_order, last_dataset = _last_build
    if dataset is not None:
        _last_build = (table_order, dataset)
    try:
        models, rows = _create_and_seed(_app_label, table_order, dataset or last_dataset)
        _report('ready', 100, 'Ready')
        return _dumps({
            'ok': True,
            'appLabel': _app_label,
            'version': _version,
            'tables': [m._meta.db_table for m in models],
            'models': [m.__name__ for m in models],
            'rows': rows,
            'fkViolations': _fk_violations(),
            'checks': _run_checks(_app_label),
            'ms': int((time.time() - started) * 1000),
        })
    except Exception:
        return _dumps({'ok': False, 'error': _error(*sys.exc_info())})


def status():
    import django
    return _dumps({
        'booted': True,
        'appLabel': _app_label,
        'version': _version,
        'django': django.get_version(),
        'python': sys.version.split()[0],
    })


# ---------------------------------------------------------------- SQL

def run_sql(query):
    started = time.time()
    query = (query or '').strip()
    if not query:
        return _dumps({'ok': False, 'error': 'Empty query'})
    try:
        with connection.cursor() as cur:
            try:
                cur.execute(query)
            except Exception as exc:  # multiple statements -> script
                if 'one statement at a time' in str(exc):
                    connection.connection.executescript(query)
                    return _dumps({'ok': True, 'columns': [], 'rows': [], 'rowcount': 0,
                                   'sql': query, 'ms': int((time.time() - started) * 1000)})
                raise
            if cur.description:
                columns = [d[0] for d in cur.description]
                rows = cur.fetchmany(ROW_CAP + 1)
                truncated = len(rows) > ROW_CAP
                rows = [list(r) for r in rows[:ROW_CAP]]
                return _dumps({'ok': True, 'columns': columns, 'rows': rows, 'rowcount': len(rows),
                               'truncated': truncated, 'sql': query,
                               'ms': int((time.time() - started) * 1000)})
            rowcount = cur.rowcount if cur.rowcount is not None and cur.rowcount >= 0 else 0
            return _dumps({'ok': True, 'columns': [], 'rows': [], 'rowcount': rowcount, 'sql': query,
                           'ms': int((time.time() - started) * 1000)})
    except Exception:
        return _dumps({'ok': False, 'error': _error(*sys.exc_info(), user_only=True)})


# ---------------------------------------------------------------- ORM

def _namespace():
    ns = {
        'Q': Q, 'F': F, 'Count': Count, 'Sum': Sum, 'Avg': Avg, 'Max': Max, 'Min': Min,
        'Prefetch': Prefetch, 'timezone': timezone, 'connection': connection,
    }
    from django.db import models as _models
    ns['models'] = _models
    if _app_label is not None:
        for m in apps.get_app_config(_app_label).get_models(include_auto_created=True):
            ns[m.__name__] = m
    return ns


def _instance_to_dict(obj):
    return {f.attname: getattr(obj, f.attname) for f in obj._meta.concrete_fields}


def _queryset_rows(qs):
    """Rows for a queryset: keep `.values()` / `.values_list()` shapes, otherwise select all fields."""
    from django.db.models.query import ModelIterable
    is_model_qs = getattr(qs, '_iterable_class', ModelIterable) is ModelIterable
    if is_model_qs and not qs.query.is_sliced:
        try:
            return list(qs.values()[: ROW_CAP + 1])
        except Exception:
            pass
    try:
        items = list(qs[: ROW_CAP + 1]) if not qs.query.is_sliced else list(qs)[: ROW_CAP + 1]
    except Exception:
        items = list(qs)[: ROW_CAP + 1]
    return [_instance_to_dict(o) if hasattr(o, '_meta') and hasattr(o, 'pk') else o for o in items]


def _tabulate(value):
    """Turn an evaluated value into (columns, rows, truncated, kind)."""
    if isinstance(value, QuerySet):
        data = _queryset_rows(value)
        return _tabulate_list(data, 'queryset')
    if hasattr(value, '_meta') and hasattr(value, 'pk'):
        return _tabulate_list([_instance_to_dict(value)], 'instance')
    if isinstance(value, dict):
        return _tabulate_list([value], 'dict')
    if isinstance(value, (list, tuple, set, frozenset)):
        items = list(value)[: ROW_CAP + 1]
        items = [_instance_to_dict(o) if hasattr(o, '_meta') and hasattr(o, 'pk') else o for o in items]
        return _tabulate_list(items, 'list')
    return ['result'], [[value]], False, 'scalar'


def _tabulate_list(items, kind):
    truncated = len(items) > ROW_CAP
    items = items[:ROW_CAP]
    if items and all(isinstance(x, dict) for x in items):
        columns = []
        for d in items:
            for k in d.keys():
                if k not in columns:
                    columns.append(k)
        rows = [[d.get(c) for c in columns] for d in items]
        return columns, rows, truncated, kind
    if items and all(isinstance(x, (list, tuple)) for x in items):
        width = max(len(x) for x in items)
        columns = ['col%d' % (i + 1) for i in range(width)]
        rows = [list(x) + [None] * (width - len(x)) for x in items]
        return columns, rows, truncated, kind
    return ['value'], [[x] for x in items], truncated, kind


def run_orm(code):
    started = time.time()
    code = code or ''
    if not code.strip():
        return _dumps({'ok': False, 'error': 'Empty snippet'})
    ns = _namespace()
    stdout = io.StringIO()
    try:
        tree = ast.parse(code, filename='<orm>', mode='exec')
    except SyntaxError:
        return _dumps({'ok': False, 'error': ''.join(traceback.format_exception_only(*sys.exc_info()[:2]))})
    last_expr = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last_expr = ast.Expression(tree.body.pop().value)
    try:
        with contextlib.redirect_stdout(stdout), CaptureQueriesContext(connection) as ctx:
            if tree.body:
                exec(compile(tree, '<orm>', 'exec'), ns)
            value = None
            query_sql = None
            if last_expr is not None:
                value = eval(compile(last_expr, '<orm>', 'eval'), ns)
                if isinstance(value, QuerySet):
                    try:
                        query_sql = str(value.query)
                    except Exception:
                        query_sql = None
            columns, rows, truncated, kind = _tabulate(value) if last_expr is not None else ([], [], False, 'none')
        sql = '\n'.join(q['sql'] for q in ctx.captured_queries) or query_sql or ''
        return _dumps({
            'ok': True, 'columns': columns, 'rows': rows, 'rowcount': len(rows), 'truncated': truncated,
            'kind': kind, 'sql': sql, 'stdout': stdout.getvalue(),
            'repr': repr(value) if kind == 'scalar' else None,
            'ms': int((time.time() - started) * 1000),
        })
    except Exception:
        # Drop the frames that belong to this runtime so the user sees their own code first.
        return _dumps({'ok': False, 'error': _error(*sys.exc_info(), user_only=True), 'stdout': stdout.getvalue()})
