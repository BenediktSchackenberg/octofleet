using System;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using OctofleetAgent.Installer.CustomActions;

// Regression runner for the MSI's service-config.json handling (installer/CustomActions/ConfigFile.cs).
internal static class Program
{
    private static int failures;

    private static void Assert(bool condition, string description)
    {
        Console.WriteLine($"{(condition ? "PASS" : "FAIL")}  {description}");
        if (!condition) failures++;
    }

    private static Dictionary<string, object> Read(string json) =>
        (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(json);

    private static bool Throws(Action action)
    {
        try { action(); return false; }
        catch (ArgumentException) { return true; }
    }

    private static int Main()
    {
        bool replaced;

        // --- New install: only the passed values ---
        var created = Read(ConfigFile.Merge(null, "https://octofleet.example.com/", " key-123 ", "", "", out replaced));
        Assert(created.Count == 2 && (string)created["InventoryApiUrl"] == "https://octofleet.example.com"
               && (string)created["InventoryApiKey"] == "key-123" && !replaced,
            "new config: server URL (without trailing slash) and key, nothing else");

        var full = Read(ConfigFile.Merge("", "http://10.0.0.5:8080", "k", "Kiosk 1", "120", out replaced));
        Assert((string)full["DisplayName"] == "Kiosk 1" && (int)full["ScheduledPushIntervalMinutes"] == 120,
            "display name and push interval (minutes, as a number)");

        // --- Upgrade/repair with properties: the rest of the config stays ---
        const string existing = @"{
  ""InventoryApiUrl"": ""http://old:8080"",
  ""InventoryApiKey"": """",
  ""InventoryApiKeyProtected"": ""dpapi:AAAA"",
  ""DisplayName"": ""PC-1"",
  ""ScheduledPushIntervalMinutes"": 30,
  ""PendingId"": null,
  ""UpdateFallbackToGitHub"": false
}";
        var urlOnly = Read(ConfigFile.Merge(existing, "https://new.example.com", "", "", "", out replaced));
        Assert((string)urlOnly["InventoryApiUrl"] == "https://new.example.com", "SERVER_URL replaces the server URL");
        Assert((string)urlOnly["InventoryApiKeyProtected"] == "dpapi:AAAA" && (string)urlOnly["DisplayName"] == "PC-1"
               && (int)urlOnly["ScheduledPushIntervalMinutes"] == 30 && (bool)urlOnly["UpdateFallbackToGitHub"] == false
               && urlOnly.ContainsKey("PendingId"),
            "values that are not passed stay (encrypted key, name, interval, other settings)");

        var newKey = Read(ConfigFile.Merge(existing, "", "new-key", "", "", out replaced));
        Assert((string)newKey["InventoryApiKey"] == "new-key" && !newKey.ContainsKey("InventoryApiKeyProtected")
               && (string)newKey["InventoryApiUrl"] == "http://old:8080",
            "API_KEY replaces the encrypted key (the service encrypts the new one)");

        // --- The agent reads keys case-insensitively: no second spelling may survive ---
        var mixedCase = Read(ConfigFile.Merge(@"{""inventoryApiUrl"":""http://old"",""displayname"":""x""}",
            "https://new", "", "Y", "", out replaced));
        Assert(mixedCase.Count == 2 && (string)mixedCase["InventoryApiUrl"] == "https://new" && (string)mixedCase["DisplayName"] == "Y",
            "other spellings of a key are replaced");

        // --- A broken file is replaced when values are passed ---
        foreach (var broken in new[] { "{ not json", "[1,2]", "\"text\"" })
        {
            var result = Read(ConfigFile.Merge(broken, "https://new", "k", "", "", out replaced));
            Assert(replaced && result.Count == 2, $"invalid config is replaced: {broken}");
        }

        // --- Invalid values fail the installation instead of writing a broken config ---
        Assert(Throws(() => ConfigFile.Merge(null, "octofleet.example.com", "k", "", "", out replaced)), "SERVER_URL without scheme is rejected");
        Assert(Throws(() => ConfigFile.Merge(null, "ftp://octofleet", "k", "", "", out replaced)), "SERVER_URL with another scheme is rejected");
        foreach (var interval in new[] { "0", "-5", "abc", "1.5", "99999999999" })
            Assert(Throws(() => ConfigFile.Merge(null, "", "", "", interval, out replaced)), $"PUSH_INTERVAL '{interval}' is rejected");

        // --- Characters that need escaping survive the round trip ---
        var escaped = Read(ConfigFile.Merge(null, "", "a\"b\\c", "Büro \"3\"", "", out replaced));
        Assert((string)escaped["InventoryApiKey"] == "a\"b\\c" && (string)escaped["DisplayName"] == "Büro \"3\"",
            "quotes, backslashes and umlauts are written as valid JSON");

        Console.WriteLine(failures == 0 ? "All installer config tests passed" : $"{failures} installer config test(s) failed");
        return failures == 0 ? 0 : 1;
    }
}
