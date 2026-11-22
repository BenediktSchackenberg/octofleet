"""The severity counts alone, without the rest of the vulnerability summary. The dashboard reads
them from the cached summary (test_vulnerability_summary_cache.py)."""
import asyncio
import unittest
from contextlib import asynccontextmanager

import vulnerability

SEVERITY_ROWS = [{"rank": 1, "count": 3}, {"rank": 2, "count": 5}, {"rank": 3, "count": 7}, {"rank": 4, "count": 1}]


class FakeConn:
    def __init__(self):
        self.queries = []

    async def fetch(self, sql, *args):
        self.queries.append(sql)
        if "GROUP BY rank" in sql:
            return SEVERITY_ROWS
        return []

    async def fetchrow(self, sql, *args):
        self.queries.append(sql)
        if "FROM nodes" in sql:
            return {"total": 7, "online": 7, "away": 0, "offline": 0}
        return {"total": 0, "success": 0, "failed": 0, "running": 0, "pending": 0}

    async def fetchval(self, sql, *args):
        self.queries.append(sql)
        return 0


class FakePool:
    def __init__(self):
        self.conn = FakeConn()

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


class DashboardSummaryQueriesTest(unittest.TestCase):
    def test_same_counts_as_the_vulnerabilities_page(self):
        counts = asyncio.run(vulnerability.get_vulnerability_severity_counts(FakePool()))
        self.assertEqual(counts, {"CRITICAL": 3, "HIGH": 5, "MEDIUM": 7, "LOW": 1})


if __name__ == "__main__":
    unittest.main()
