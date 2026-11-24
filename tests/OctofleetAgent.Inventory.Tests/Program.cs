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

    // App Control for Business (WDAC): CiTool --list-policies --json
    var ciPolicies = SecurityCollector.ParseCiToolPolicies("""
        {"Policies":[{"BasePolicyID":"d2bda982-ccf6-4344-ac5b-0b44427b6816","FriendlyName":"Microsoft Windows Driver Policy",
          "IsAuthorized":true,"IsEnforced":true,"IsOnDisk":false,"IsSignedPolicy":true,"IsSystemPolicy":true,
          "PolicyID":"d2bda982-ccf6-4344-ac5b-0b44427b6816","Version":2814751463211012,"VersionString":"10.0.26100.4"}],
         "OperationResult":0}
        """);
    Assert(ciPolicies?.Count == 1 && ciPolicies[0].FriendlyName == "Microsoft Windows Driver Policy"
        && ciPolicies[0].Version == "10.0.26100.4" && ciPolicies[0].IsSystemPolicy == true && ciPolicies[0].IsEnforced == true,
        "CiTool policies are read with name, version and flags");
    Assert(SecurityCollector.ParseCiToolPolicies("{\"OperationResult\":-2147024891}") == null,
        "A failed CiTool call (access denied) falls back to the policy files");

    // AppLocker: Get-AppLockerPolicy -Effective -Xml
    var appLocker = SecurityCollector.ParseAppLockerPolicy("""
        <AppLockerPolicy Version="1">
          <RuleCollection Type="Exe" EnforcementMode="AuditOnly">
            <FilePathRule Id="1" Name="All files" UserOrGroupSid="S-1-1-0" Action="Allow"><Conditions /></FilePathRule>
            <FilePublisherRule Id="2" Name="Signed" UserOrGroupSid="S-1-1-0" Action="Allow"><Conditions /></FilePublisherRule>
          </RuleCollection>
          <RuleCollection Type="Script" EnforcementMode="Enabled">
            <FileHashRule Id="3" Name="Hash" UserOrGroupSid="S-1-1-0" Action="Deny"><Conditions /></FileHashRule>
          </RuleCollection>
        </AppLockerPolicy>
        """);
    Assert(appLocker.Count == 2 && appLocker[0].Type == "Exe" && appLocker[0].EnforcementMode == "AuditOnly"
        && appLocker[0].RuleCount == 2 && appLocker[1].RuleCount == 1,
        "AppLocker collections are read with mode and rule count");
    Assert(SecurityCollector.ParseAppLockerPolicy("<AppLockerPolicy Version=\"1\" />").Count == 0,
        "An empty AppLocker policy has no collections");
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
