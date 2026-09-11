using System.Data.SQLite;
using System.Reflection;
using OctofleetAgent.Service.Inventory;

// Self-contained regression runner; all inputs are synthetic, temporary files.
var testRoot = Path.Combine(Path.GetTempPath(), $"octofleet-inventory-tests-{Guid.NewGuid():N}");
Directory.CreateDirectory(testRoot);
try
{
    var database = Path.Combine(testRoot, "Cookies");
    using (var connection = new SQLiteConnection($"Data Source={database};Pooling=False;"))
    {
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE cookies (
                host_key TEXT, name TEXT, path TEXT, expires_utc INTEGER,
                is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, is_persistent INTEGER
            );
            """;
        command.ExecuteNonQuery();
    }

    var empty = ReadCookies(database);
    Assert(empty.Count == 0 && empty.Error == null, "Empty database is a successful inventory result");

    using (var connection = new SQLiteConnection($"Data Source={database};Pooling=False;"))
    {
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO cookies VALUES ('example.test', 'test', '/', 0, 1, 1, 2, 0);";
        command.ExecuteNonQuery();
    }
    var readable = ReadCookies(database);
    Assert(readable.Count == 1 && readable.Error == null, "Readable cookie metadata remains available");

    SQLiteConnection.ClearAllPools();
    var originalBytes = File.ReadAllBytes(database);
    using (var lockedFile = new FileStream(database, FileMode.Open, FileAccess.Read, FileShare.None))
    {
        var locked = ReadCookies(database);
        Assert(locked.Count == -1 && locked.Error?.Contains("locking the database") == true,
            "Exclusive lock is reported as unavailable");
    }
    Assert(originalBytes.SequenceEqual(File.ReadAllBytes(database)), "Inventory does not modify the source database");

    var corruptDatabase = Path.Combine(testRoot, "CorruptCookies");
    File.WriteAllText(corruptDatabase, "This is not a SQLite database.");
    var corrupt = ReadCookies(corruptDatabase);
    Assert(corrupt.Count == -1 && corrupt.Error != null, "Corrupt database is reported as unavailable");

    Console.WriteLine("All 5 browser inventory regression checks passed.");
}
finally
{
    SQLiteConnection.ClearAllPools();
    Directory.Delete(testRoot, recursive: true);
}

static (int Count, string? Error) ReadCookies(string path)
{
    var method = typeof(BrowserCollector).GetMethod("GetChromiumCookiesWithRetry", BindingFlags.NonPublic | BindingFlags.Static)!;
    var result = method.Invoke(null, new object[] { path, "TestBrowser" })!;
    return ((int)result.GetType().GetProperty("Count")!.GetValue(result)!,
        (string?)result.GetType().GetProperty("Error")!.GetValue(result));
}

static void Assert(bool condition, string message)
{
    if (!condition) throw new Exception(message);
    Console.WriteLine($"PASS: {message}");
}
