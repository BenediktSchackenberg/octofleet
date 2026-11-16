"""The dashboard summary shows four vulnerability counts; it must not run the whole vulnerability
summary (affected nodes, top CVEs, top software), which takes seconds with many findings."""
import asyncio
import unittest
from contextlib import asynccontextmanager

import vulnerability
from routers import dashboard

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
    def test_only_the_severity_count(self):
        pool = FakePool()
        result = asyncio.run(dashboard.get_dashboard_summary(pool))
        findings_queries = [q for q in pool.conn.queries if "node_vulnerability_findings" in q]
        self.assertEqual(len(findings_queries), 1, "one query over the findings")
        self.assertIn("GROUP BY rank", findings_queries[0])
        self.assertFalse(any("verified_vulnerabilities" in q or "fix_unit" in q for q in pool.conn.queries),
                         "no top CVEs, top software or last scan")
        self.assertEqual(result["vulnerabilities"], {"total": 16, "critical": 3, "high": 5, "medium": 7, "low": 1})

    def test_same_counts_as_the_vulnerabilities_page(self):
        counts = asyncio.run(vulnerability.get_vulnerability_severity_counts(FakePool()))
        self.assertEqual(counts, {"CRITICAL": 3, "HIGH": 5, "MEDIUM": 7, "LOW": 1})


if __name__ == "__main__":
    unittest.main()
