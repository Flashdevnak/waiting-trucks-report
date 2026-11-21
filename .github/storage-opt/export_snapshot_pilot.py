#!/usr/bin/env python3
"""Offline WTR storage study. No provider calls or changes to exported source.

Requires a private SQLite .db and matching .db-wal. Uses the SQLite backup API to
make a consistent local copy, then VACUUM INTO a separate compacted candidate.
This script does not authorize a live cutover or claim a Turso quota reduction.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import struct
import sys

MASK = (1 << 256) - 1

def quote(name):
    return '"' + name.replace('"', '""') + '"'

def ro(path):
    conn = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
    conn.execute('PRAGMA query_only=ON')
    return conn

def integrity(db):
    if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
        raise RuntimeError('SQLite integrity check failed')
    if db.execute('PRAGMA foreign_key_check').fetchone() is not None:
        raise RuntimeError('SQLite foreign-key check failed')

def encode(val):
    if val is None:
        tag, data = b'N', b''
    elif isinstance(val, bytes):
        tag, data = b'B', val
    elif isinstance(val, str):
        tag, data = b'T', val.encode('utf-8')
    elif isinstance(val, int):
        tag, data = b'I', str(val).encode('ascii')
    elif isinstance(val, float):
        tag, data = b'F', struct.pack('>d', val)
    else:
        raise RuntimeError('Unsupported SQLite type')
    return tag + len(data).to_bytes(8, 'big') + data

def summary(db):
    names = [r[0] for r in db.execute(
        "SELECT name FROM sqlite_schema WHERE type='table' AND "
        "(name NOT LIKE 'sqlite_%' OR name='sqlite_sequence') ORDER BY name")]
    result = {}
    for name in names:
        cols = [r[1] for r in db.execute('PRAGMA table_info(' + quote(name) + ')')]
        if not cols:
            raise RuntimeError('Table columns unavailable')
        digest_sum, digest_xor, count = 0, 0, 0
        cur = db.execute('SELECT ' + ','.join(map(quote, cols)) +
                         ' FROM ' + quote(name))
        for row in cur:
            hasher = hashlib.sha256()
            for item in row:
                hasher.update(encode(item))
            n = int.from_bytes(hasher.digest(), 'big')
            digest_sum = (digest_sum + n) & MASK
            digest_xor ^= n
            count += 1
        result[name] = [cols, count, f'{digest_sum:064x}:{digest_xor:064x}']
    return result

def pointer(db):
    tables = {r[0] for r in db.execute(
        "SELECT name FROM sqlite_schema WHERE type='table'")}
    if not {'ms_route_latest', 'ms_route_history'} <= tables:
        return {'available': False}
    count, invalid = db.execute("""
        SELECT COUNT(*), SUM(CASE WHEN h.history_id IS NULL
          OR h.hub<>l.hub OR h.route_id<>l.route_id
          OR h.snapshot_at<>l.snapshot_at THEN 1 ELSE 0 END)
        FROM ms_route_latest l LEFT JOIN ms_route_history h
          ON h.rowid=l.history_rowid
    """).fetchone()
    digest = hashlib.sha256()
    cur = db.execute("""
        SELECT l.hub,l.route_id,l.history_rowid,l.snapshot_at,
               l.business_day,h.history_id
        FROM ms_route_latest l LEFT JOIN ms_route_history h
          ON h.rowid=l.history_rowid ORDER BY l.hub,l.route_id
    """)
    for row in cur:
        for item in row:
            digest.update(encode(item))
    return {'available': True, 'count': count,
            'invalid': invalid or 0, 'sha': digest.hexdigest()}

def asof(db):
    tables = {r[0] for r in db.execute(
        "SELECT name FROM sqlite_schema WHERE type='table'")}
    if not {'ms_route_registry', 'ms_route_history'} <= tables:
        return {'available': False}
    cutoffs = [r[0] for r in db.execute(
        'SELECT snapshot_at FROM ms_route_history ORDER BY rowid DESC LIMIT 2')]
    routes = db.execute(
        'SELECT hub,route_id FROM ms_route_registry ORDER BY hub,route_id LIMIT 12'
    ).fetchall()
    hasher = hashlib.sha256()
    for cutoff in cutoffs:
        for hub, route_id in routes:
            record = db.execute("""
                SELECT history_id,snapshot_at,event_type,payload_json,synced_by
                FROM ms_route_history INDEXED BY idx_ms_route_history_hub_route_snapshot
                WHERE hub=? AND route_id=? AND snapshot_at<=?
                ORDER BY snapshot_at DESC,rowid DESC LIMIT 1
            """, (hub, route_id, cutoff)).fetchone()
            for item in (cutoff, hub, route_id, *(record or (None,))):
                hasher.update(encode(item))
    return {'available': True, 'cases': len(cutoffs)*len(routes),
            'sha': hasher.hexdigest()}

def object_sizes(db):
    try:
        objects = [{'object': name, 'bytes': size} for name, size in
                   db.execute('SELECT name,SUM(pgsize) FROM dbstat GROUP BY name')]
        return sorted(objects, key=lambda r: r['bytes'], reverse=True)[:12]
    except sqlite3.DatabaseError:
        return None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--export-db', required=True)
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()
    source = Path(args.export_db).resolve(strict=True)
    wal = Path(str(source) + '-wal')
    if not wal.is_file() or not wal.stat().st_size:
        raise RuntimeError('Non-empty .db-wal missing (tursodb .db-log unsupported)')
    if source.stat().st_size < 100:
        raise RuntimeError('Export database too small')
    out = Path(args.output_dir).resolve()
    out.mkdir(parents=True, mode=0o700, exist_ok=True)
    baseline = out / 'normalized-snapshot.db'
    compact = out / 'compacted-candidate.db'
    if baseline.exists() or compact.exists():
        raise RuntimeError('Output exists: refuse overwrite')

    # Read the export and its WAL as one SQLite database; never use immutable=1.
    original = ro(source)
    try:
        dest = sqlite3.connect(baseline)
        try:
            original.backup(dest, pages=1000)
        finally:
            dest.close()
    finally:
        original.close()

    # This writable connection opens a *working copy*, not the export or Turso.
    db = sqlite3.connect(baseline)
    try:
        integrity(db)
        before = summary(db)
        pointer_before, asof_before = pointer(db), asof(db)
        largest = object_sizes(db)
        db.execute('VACUUM INTO ?', (str(compact),))
    finally:
        db.close()
    after_db = ro(compact)
    try:
        integrity(after_db)
        after = summary(after_db)
        pointer_after, asof_after = pointer(after_db), asof(after_db)
    finally:
        after_db.close()

    same_rows = before == after
    same_pointer = (pointer_before == pointer_after and
                    pointer_before.get('invalid', 0) == 0)
    same_asof = asof_before == asof_after
    before_bytes, after_bytes = baseline.stat().st_size, compact.stat().st_size
    report = {
        'scope': 'OFFLINE_COPY_ONLY_NOT_LIVE_PROVIDER',
        'source_db_bytes': source.stat().st_size,
        'source_wal_bytes': wal.stat().st_size,
        'normalized_before_bytes': before_bytes,
        'vacuum_into_after_bytes': after_bytes,
        'candidate_savings_bytes': before_bytes - after_bytes,
        'candidate_savings_pct': round(
            100*(before_bytes-after_bytes)/before_bytes, 3) if before_bytes else None,
        'table_count': len(before),
        'total_rows': sum(item[1] for item in before.values()),
        'integrity_before_after': 'PASS',
        'logical_rows_same': same_rows,
        'history_rowid_pointer_same': same_pointer,
        'asof_probe_same': same_asof,
        'asof_cases': asof_before.get('cases', 0),
        'top_objects_copy_only': largest,
        'live_turso_reduction_bytes': 0,
        'cutover_authorized': False,
        'decision': 'OFFLINE_ONLY__DO_NOT_CUTOVER',
    }
    (out / 'aggregate-report.json').write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + '\n',
        encoding='utf-8')
    for key in ('source_db_bytes', 'source_wal_bytes',
                'normalized_before_bytes', 'vacuum_into_after_bytes',
                'candidate_savings_bytes', 'logical_rows_same',
                'history_rowid_pointer_same', 'asof_probe_same',
                'asof_cases', 'live_turso_reduction_bytes'):
        print(key.upper() + '=' + str(report[key]))
    print('CUTOVER_AUTHORIZED=NO')
    if not (same_rows and same_pointer and same_asof):
        raise RuntimeError('Offline equivalence gate blocked')

if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Deliberately hide SQLite exception details: never leak business rows.
        print('WTR_STORAGE_OFFLINE_PILOT=BLOCKED', file=sys.stderr)
        raise SystemExit(1)
