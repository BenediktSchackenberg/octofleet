"""JSON columns go out as JSON values, not as JSON text inside JSON.

asyncpg returns json/jsonb columns as text. A route that passes that text on sends a string
holding JSON (`"{\\"at\\": …}"`) instead of the object, and pages showed it like that (job
"Command data", audit log details). `decode_json` parses it once.

`ensure_schema` repairs rows that hold a JSON *string* with an object or array inside (written
by encoding twice). It changes only those rows, only when the text is valid JSON, and is a
no-op when there are none.
"""
import json
import logging
from typing import Any

import asyncpg

logger = logging.getLogger(__name__)

# (table, jsonb column) shown on pages
JSON_COLUMNS = (("jobs", "command_data"), ("audit_log", "details"))


def decode_json(value: Any) -> Any:
    """The value of a json/jsonb column as a Python value.

    Text from asyncpg is parsed; a parsed string that itself holds a JSON object or array
    (a value encoded twice) is parsed once more. Plain strings, numbers and values that are
    already parsed are returned as they are.
    """
    if isinstance(value, (bytes, bytearray)):
        value = value.decode()
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return value
    if isinstance(value, str) and value.lstrip()[:1] in ("{", "["):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


async def normalize_double_encoded(conn: asyncpg.Connection) -> dict:
    """Turn JSON strings that hold an object or array back into that object or array.

    One set-based UPDATE per column; returns the number of rows changed per table.
    Needs PostgreSQL 16 (`pg_input_is_valid`); older servers are skipped.
    """
    if await conn.fetchval("SELECT current_setting('server_version_num')::int") < 160000:
        return {}
    changed = {}
    for table, column in JSON_COLUMNS:
        result = await conn.execute(f"""
            UPDATE {table} SET {column} = ({column} #>> '{{}}')::jsonb
            WHERE jsonb_typeof({column}) = 'string'
              AND left(ltrim({column} #>> '{{}}'), 1) IN ('{{', '[')
              AND pg_input_is_valid({column} #>> '{{}}', 'jsonb')
        """)
        changed[table] = int(result.split()[-1])
    return changed


async def ensure_schema(pool: asyncpg.Pool) -> None:
    """Started in the background at startup: a full scan of each table (about 0.7 s per
    million audit entries), and reads decode such rows anyway."""
    try:
        async with pool.acquire() as conn:
            changed = await normalize_double_encoded(conn)
    except Exception:
        logger.exception("Decoding double-encoded JSON values failed")
        return
    for table, count in changed.items():
        if count:
            logger.info("Decoded %d double-encoded JSON value(s) in %s", count, table)
