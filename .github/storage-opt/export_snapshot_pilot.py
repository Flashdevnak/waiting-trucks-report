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
import shutil
import struct
import sys

MASK = (1 << 256) - 1
WAL_WORD_MASK = (1 << 32) - 1

def quote(name):
    return '"' + name.replace('"', '""') + '"'

def ro(path):
    conn = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
    conn.execute('PRAGMA query_only=ON')
    conn.execute('PRAGMA trusted_schema=OFF')
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
    result = {}
    for schema, name, kind, _, without_rowid, _ in db.execute('PRAGMA table_list').fetchall():
        if schema != 'main' or (name.startswith('sqlite_') and name != 'sqlite_sequence'):
            continue
        if kind == 'view':
            continue
        if kind != 'table':
            raise RuntimeError('Unsupported virtual or shadow table')
        info = db.execute(f'PRAGMA table_xinfo({quote(name)})').fetchall()
        columns = [quote(row[1]) for row in info]
        count = 0
        digest_sum, digest_xor = 0, 0
        if name == 'ms_route_history':
            if without_rowid or {row[1].lower() for row in info} & {'rowid'}:
                raise RuntimeError('Physical history rowid is unavailable')
            columns.insert(0, 'rowid')
        if not columns:
            raise RuntimeError('Table columns unavailable')
        cur = db.execute(f'SELECT {", ".join(columns)} FROM {quote(name)}')
        for row in cur:
            hasher = hashlib.sha256()
            for item in row:
                hasher.update(encode(item))
            n = int.from_bytes(hasher.digest(), 'big')
            digest_sum = (digest_sum + n) & MASK
            digest_xor ^= n
            count += 1
        result[name] = [columns, count, f'{digest_sum:064x}:{digest_xor:064x}']
    return result

def pointer(db):
    tables = {r[0] for r in db.execute(
        "SELECT name FROM sqlite_schema WHERE type='table'")}
    if not {'ms_route_latest', 'ms_route_history'} <= tables:
        return {'available': False}
    count, invalid = db.execute("""
        SELECT COUNT(*), SUM(CASE WHEN h.history_id IS NULL
          OR h.hub IS NOT l.hub OR h.route_id IS NOT l.route_id
          OR h.snapshot_at IS NOT l.snapshot_at THEN 1 ELSE 0 END)
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
    extremes = []
    for order in ('ASC', 'DESC'):
        extremes.extend(db.execute(
            f'SELECT hub,route_id,snapshot_at FROM ms_route_history ORDER BY rowid {order} LIMIT 6'
        ).fetchall())
    cutoffs = sorted({row[2] for row in extremes if row[2]})
    routes = sorted({row[:2] for row in extremes})
    matched = 0
    hasher = hashlib.sha256()
    for cutoff in cutoffs:
        for hub, route_id in routes:
            record = db.execute("""
                SELECT history_id,snapshot_at,event_type,payload_json,synced_by
                FROM ms_route_history INDEXED BY idx_ms_route_history_hub_route_snapshot
                WHERE hub=? AND route_id=? AND snapshot_at<=?
                ORDER BY snapshot_at DESC,rowid DESC LIMIT 1
            """, (hub, route_id, cutoff)).fetchone()
            matched += int(record is not None)
            for item in (cutoff, hub, route_id, *(record or (None,))):
                hasher.update(encode(item))
    return {'available': True, 'cases': len(cutoffs)*len(routes),
            'matched': matched, 'sha': hasher.hexdigest()}

def object_sizes(db):
    return [{'object': name, 'bytes': size} for name, size in db.execute(
        'SELECT name,pgsize FROM dbstat WHERE aggregate=1 ORDER BY pgsize DESC,name')]


def schema_columns_and_code(db):
    return db.execute(
        'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name'
    ).fetchall()


def file_sha256(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def wal_checksum(words, data, state=(0, 0)):
    first, second = state
    for left, right in words.iter_unpack(data):
        first = (first + left + second) & WAL_WORD_MASK
        second = (second + right + first) & WAL_WORD_MASK
    return first, second


def wal_probe(source, wal):
    # SQLite may silently stop at an invalid frame and accept the valid prefix.
    # Check the complete chain before opening the copy with SQLite.
    with source.open('rb') as handle:
        header = handle.read(100)
    if not header.startswith(b'SQLite format 3\0') or header[18:20] != b'\x02\x02':
        raise RuntimeError('Expected a SQLite WAL-mode source')
    page_size = int.from_bytes(header[16:18], 'big')
    page_size = 65536 if page_size == 1 else page_size
    with wal.open('rb') as handle:
        header = handle.read(32)
        magic = int.from_bytes(header[:4], 'big')
        if (len(header) != 32 or magic not in (0x377f0682, 0x377f0683)
                or int.from_bytes(header[4:8], 'big') != 3007000
                or int.from_bytes(header[8:12], 'big') != page_size
                or page_size not in (512, 1024, 2048, 4096, 8192, 16384, 32768, 65536)):
            raise RuntimeError('Invalid SQLite WAL header')
        words = struct.Struct('<II' if magic == 0x377f0682 else '>II')
        checksum = wal_checksum(words, header[:24])
        if checksum != struct.unpack('>II', header[24:32]):
            raise RuntimeError('Invalid SQLite WAL header checksum')
        size = wal.stat().st_size
        frame_size = 24 + page_size
        if size <= 32 or (size - 32) % frame_size:
            raise RuntimeError('Incomplete SQLite WAL frame')
        frame_count = (size - 32) // frame_size
        salt = header[16:24]
        for _ in range(frame_count):
            frame = handle.read(24)
            data = handle.read(page_size)
            if (len(frame) != 24 or len(data) != page_size
                    or frame[:4] == b'\0' * 4 or frame[8:16] != salt):
                raise RuntimeError('Invalid WAL frame metadata')
            checksum = wal_checksum(words, frame[:8], checksum)
            checksum = wal_checksum(words, data, checksum)
            if checksum != struct.unpack('>II', frame[16:24]):
                raise RuntimeError('Invalid SQLite WAL frame checksum')
        if handle.read(1):
            raise RuntimeError('WAL grew during validation')
        # An export ending in an uncommitted transaction cannot certify the
        # final replay boundary. Leave such a pair for provider verification.
        _, final_pages = struct.unpack('>II', frame[:8])
        if not final_pages:
            raise RuntimeError('WAL does not end with a committed frame')
        offset = size - frame_size
        while offset >= 32:
            handle.seek(offset)
            frame = handle.read(24)
            page = int.from_bytes(frame[:4], 'big')
            if frame[8:16] != header[16:24] or not page:
                raise RuntimeError('Invalid WAL frame metadata')
            if page <= final_pages:
                return final_pages, page, page_size, handle.read(page_size), frame_count
            offset -= frame_size
    raise RuntimeError('No committed replay witness')


def verify_replay(path, witness):
    final_pages, page, page_size, expected, _ = witness
    if path.stat().st_size != final_pages * page_size:
        raise RuntimeError('Snapshot page count does not match committed WAL size')
    with path.open('rb') as handle:
        handle.seek((page - 1) * page_size)
        page_data = handle.read(page_size)
    # SQLite backup may update database-header fields on page one.
    skip = 100 if page == 1 else 0
    if page_data[skip:] != expected[skip:]:
        raise RuntimeError('SQLite did not replay the expected WAL page')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--export-db', required=True)
    parser.add_argument('--output-dir', required=True)
    args = parser.parse_args()
    source = Path(args.export_db).resolve(strict=True)
    wal = Path(str(source) + '-wal')
    if (Path(str(source) + '-log').exists() or wal.is_symlink()
            or not wal.is_file() or not wal.stat().st_size):
        raise RuntimeError('Non-empty .db-wal missing (tursodb .db-log unsupported)')
    if source.stat().st_size < 100:
        raise RuntimeError('Export database too small')
    out = Path(args.output_dir).resolve()
    out.mkdir(parents=True, mode=0o700, exist_ok=True)
    if out.stat().st_mode & 0o077:
        raise RuntimeError('Output directory must be private')
    db_bytes, wal_bytes = source.stat().st_size, wal.stat().st_size
    # Reserve space for the private pair before copying any business data.
    if shutil.disk_usage(out).free < db_bytes + wal_bytes:
        raise RuntimeError('Insufficient private disk for the exported pair')
    db_digest, wal_digest = file_sha256(source), file_sha256(wal)
    replay = out / 'wal-replay'
    replay.mkdir(mode=0o700)
    replay_db = replay / 'source.db'
    replay_wal = replay / 'source.db-wal'
    shutil.copyfile(source, replay_db)
    shutil.copyfile(wal, replay_wal)
    if file_sha256(replay_db) != db_digest or file_sha256(replay_wal) != wal_digest:
        raise RuntimeError('Private copy differs from the supplied export')
    witness = wal_probe(replay_db, replay_wal)
    minimum = 3 * witness[0] * witness[2]
    if shutil.disk_usage(out).free < minimum:
        raise RuntimeError('Insufficient private disk for replay and compaction')
    baseline = out / 'normalized-snapshot.db'
    compact = out / 'compacted-candidate.db'
    if baseline.exists() or compact.exists():
        raise RuntimeError('Output exists: refuse overwrite')

    # Read the export and its WAL as one SQLite database; never use immutable=1.
    original = ro(replay_db)
    try:
        dest = sqlite3.connect(baseline)
        try:
            original.backup(dest, pages=1000)
        finally:
            dest.close()
    finally:
        original.close()
    verify_replay(baseline, witness)

    # This writable connection opens a *working copy*, not the export or Turso.
    db = sqlite3.connect(baseline)
    try:
        integrity(db)
        schema_before = schema_columns_and_code(db)
        before = summary(db)
        free_bytes = db.execute('PRAGMA freelist_count').fetchone()[0] * witness[2]
        pointer_before, asof_before = pointer(db), asof(db)
        largest = object_sizes(db)
        db.execute('VACUUM INTO ?', (str(compact),))
    finally:
        db.close()
    after_db = ro(compact)
    try:
        integrity(after_db)
        schema_after = schema_columns_and_code(after_db)
        after = summary(after_db)
        pointer_after, asof_after = pointer(after_db), asof(after_db)
    finally:
        after_db.close()

    same_rows = before == after and schema_before == schema_after
    same_pointer = (pointer_before == pointer_after and pointer_before['available']
                    and pointer_before['count'] > 0 and pointer_before['invalid'] == 0)
    same_asof = (asof_before == asof_after and asof_before['available']
                 and asof_before['matched'] > 0)
    before_bytes, after_bytes = baseline.stat().st_size, compact.stat().st_size
    report = {
        'scope': 'OFFLINE_COPY_ONLY_NOT_LIVE_PROVIDER',
        'source_db_bytes': db_bytes,
        'source_wal_bytes': wal_bytes,
        'source_db_sha256': db_digest,
        'source_wal_sha256': wal_digest,
        'validated_wal_frame_count': witness[4],
        'provider_export_boundary': 'NOT_VERIFIED',
        'normalized_before_bytes': before_bytes,
        'vacuum_into_after_bytes': after_bytes,
        'candidate_savings_bytes': before_bytes - after_bytes,
        'normalized_freelist_bytes': free_bytes,
        'candidate_savings_pct': round(
            100*(before_bytes-after_bytes)/before_bytes, 3) if before_bytes else None,
        'table_count': len(before),
        'total_rows': sum(item[1] for item in before.values()),
        'integrity_before_after': 'PASS',
        'logical_rows_same': same_rows,
        'history_rowid_pointer_same': same_pointer,
        'asof_sql_probe_same': same_asof,
        'runtime_api_asof': 'NOT_VERIFIED',
        'post_export_write_continuity': 'NOT_VERIFIED',
        'asof_cases': asof_before.get('cases', 0),
        'asof_matching_cases': asof_before.get('matched', 0),
        'objects_copy_only': largest,
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
                'history_rowid_pointer_same', 'asof_sql_probe_same',
                'asof_cases', 'live_turso_reduction_bytes'):
        print(key.upper() + '=' + str(report[key]))
    print('CUTOVER_AUTHORIZED=NO')
    if not (same_rows and same_pointer and same_asof):
        raise RuntimeError('Offline equivalence gate blocked')

if __name__ == '__main__':
    try:
        import os
        os.umask(0o077)
        main()
    except Exception:
        # Deliberately hide SQLite exception details: never leak business rows.
        print('WTR_STORAGE_OFFLINE_PILOT=BLOCKED', file=sys.stderr)
        raise SystemExit(1)
