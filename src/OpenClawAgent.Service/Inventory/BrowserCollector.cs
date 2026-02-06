using System.Data.SQLite;
using System.Text.Json;

namespace OpenClawAgent.Service.Inventory;

/// <summary>
/// Collects browser data (Chrome, Firefox, Edge)
/// </summary>
public static class BrowserCollector
{
    public static async Task<object> CollectAsync(string? browser = null)
    {
        var results = new Dictionary<string, object>();

        if (browser == null || browser == "chrome")
            results["chrome"] = await CollectChromeAsync();
        
        if (browser == null || browser == "edge")
            results["edge"] = await CollectEdgeAsync();
        
        if (browser == null || browser == "firefox")
            results["firefox"] = await CollectFirefoxAsync();

        return results;
    }

    private static async Task<object> CollectChromeAsync()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var chromePath = Path.Combine(localAppData, "Google", "Chrome", "User Data");
        
        return await CollectChromiumAsync(chromePath, "Chrome");
    }

    private static async Task<object> CollectEdgeAsync()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var edgePath = Path.Combine(localAppData, "Microsoft", "Edge", "User Data");
        
        return await CollectChromiumAsync(edgePath, "Edge");
    }

    private static async Task<object> CollectChromiumAsync(string userDataPath, string browserName)
    {
        return await Task.Run(() =>
        {
            if (!Directory.Exists(userDataPath))
                return new { installed = false };

            var profiles = new List<object>();
            
            // Find all profiles (Default, Profile 1, Profile 2, etc.)
            var profileDirs = Directory.GetDirectories(userDataPath)
                .Where(d => 
                {
                    var name = Path.GetFileName(d);
                    return name == "Default" || name.StartsWith("Profile ");
                })
                .ToList();

            foreach (var profileDir in profileDirs)
            {
                var profileName = Path.GetFileName(profileDir);
                var profileData = new Dictionary<string, object>
                {
                    ["name"] = profileName
                };

                // Extensions
                var extensionsDir = Path.Combine(profileDir, "Extensions");
                if (Directory.Exists(extensionsDir))
                {
                    profileData["extensions"] = GetChromiumExtensions(extensionsDir);
                }

                // Cookies count (from SQLite)
                var cookiesDb = Path.Combine(profileDir, "Network", "Cookies");
                if (!File.Exists(cookiesDb))
                    cookiesDb = Path.Combine(profileDir, "Cookies");
                
                if (File.Exists(cookiesDb))
                {
                    profileData["cookiesCount"] = CountSqliteRows(cookiesDb, "cookies");
                }

                // History count
                var historyDb = Path.Combine(profileDir, "History");
                if (File.Exists(historyDb))
                {
                    profileData["historyCount"] = CountSqliteRows(historyDb, "urls");
                }

                // Login Data count
                var loginDb = Path.Combine(profileDir, "Login Data");
                if (File.Exists(loginDb))
                {
                    profileData["loginsCount"] = CountSqliteRows(loginDb, "logins");
                }

                // Bookmarks count
                var bookmarksFile = Path.Combine(profileDir, "Bookmarks");
                if (File.Exists(bookmarksFile))
                {
                    profileData["bookmarksCount"] = CountBookmarks(bookmarksFile);
                }

                profiles.Add(profileData);
            }

            return new
            {
                installed = true,
                profileCount = profiles.Count,
                profiles = profiles
            };
        });
    }

    private static object GetChromiumExtensions(string extensionsDir)
    {
        var extensions = new List<object>();

        try
        {
            foreach (var extDir in Directory.GetDirectories(extensionsDir))
            {
                var extId = Path.GetFileName(extDir);
                
                // Get latest version folder
                var versionDirs = Directory.GetDirectories(extDir).OrderByDescending(d => d).ToList();
                if (versionDirs.Count == 0) continue;

                var latestVersion = versionDirs[0];
                var manifestPath = Path.Combine(latestVersion, "manifest.json");
                
                if (!File.Exists(manifestPath)) continue;

                try
                {
                    var manifestJson = File.ReadAllText(manifestPath);
                    var manifest = JsonDocument.Parse(manifestJson);
                    var root = manifest.RootElement;

                    var name = root.TryGetProperty("name", out var nameProp) 
                        ? nameProp.GetString() 
                        : extId;
                    var version = root.TryGetProperty("version", out var versionProp) 
                        ? versionProp.GetString() 
                        : "unknown";
                    var description = root.TryGetProperty("description", out var descProp) 
                        ? descProp.GetString() 
                        : null;

                    // Skip __MSG_ placeholders in name
                    if (name?.StartsWith("__MSG_") == true)
                    {
                        name = extId;
                    }

                    extensions.Add(new
                    {
                        id = extId,
                        name = name,
                        version = version,
                        description = description?.Length > 100 
                            ? description.Substring(0, 100) + "..." 
                            : description
                    });
                }
                catch
                {
                    extensions.Add(new { id = extId, name = extId, error = "Failed to parse manifest" });
                }
            }
        }
        catch
        {
            return new { error = "Failed to enumerate extensions" };
        }

        return extensions;
    }

    private static async Task<object> CollectFirefoxAsync()
    {
        return await Task.Run(() =>
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var firefoxPath = Path.Combine(appData, "Mozilla", "Firefox");
            var profilesIni = Path.Combine(firefoxPath, "profiles.ini");

            if (!File.Exists(profilesIni))
                return new { installed = false };

            var profiles = new List<object>();

            // Parse profiles.ini
            var lines = File.ReadAllLines(profilesIni);
            string? currentPath = null;
            bool isRelative = true;

            foreach (var line in lines)
            {
                if (line.StartsWith("Path="))
                {
                    currentPath = line.Substring(5);
                }
                else if (line.StartsWith("IsRelative="))
                {
                    isRelative = line.Substring(11) == "1";
                }
                else if (line.StartsWith("[") && currentPath != null)
                {
                    // Process previous profile
                    var fullPath = isRelative 
                        ? Path.Combine(firefoxPath, currentPath)
                        : currentPath;

                    if (Directory.Exists(fullPath))
                    {
                        profiles.Add(CollectFirefoxProfile(fullPath, Path.GetFileName(fullPath)));
                    }

                    currentPath = null;
                    isRelative = true;
                }
            }

            // Don't forget last profile
            if (currentPath != null)
            {
                var fullPath = isRelative 
                    ? Path.Combine(firefoxPath, currentPath)
                    : currentPath;

                if (Directory.Exists(fullPath))
                {
                    profiles.Add(CollectFirefoxProfile(fullPath, Path.GetFileName(fullPath)));
                }
            }

            return new
            {
                installed = true,
                profileCount = profiles.Count,
                profiles = profiles
            };
        });
    }

    private static object CollectFirefoxProfile(string profilePath, string profileName)
    {
        var profileData = new Dictionary<string, object>
        {
            ["name"] = profileName
        };

        // Extensions
        var extensionsJson = Path.Combine(profilePath, "extensions.json");
        if (File.Exists(extensionsJson))
        {
            profileData["extensions"] = GetFirefoxExtensions(extensionsJson);
        }

        // Cookies
        var cookiesDb = Path.Combine(profilePath, "cookies.sqlite");
        if (File.Exists(cookiesDb))
        {
            profileData["cookiesCount"] = CountSqliteRows(cookiesDb, "moz_cookies");
        }

        // History
        var placesDb = Path.Combine(profilePath, "places.sqlite");
        if (File.Exists(placesDb))
        {
            profileData["historyCount"] = CountSqliteRows(placesDb, "moz_places");
            profileData["bookmarksCount"] = CountSqliteRows(placesDb, "moz_bookmarks");
        }

        // Logins
        var loginsJson = Path.Combine(profilePath, "logins.json");
        if (File.Exists(loginsJson))
        {
            try
            {
                var json = JsonDocument.Parse(File.ReadAllText(loginsJson));
                if (json.RootElement.TryGetProperty("logins", out var logins))
                {
                    profileData["loginsCount"] = logins.GetArrayLength();
                }
            }
            catch
            {
                profileData["loginsCount"] = -1;
            }
        }

        return profileData;
    }

    private static object GetFirefoxExtensions(string extensionsJsonPath)
    {
        var extensions = new List<object>();

        try
        {
            var json = JsonDocument.Parse(File.ReadAllText(extensionsJsonPath));
            
            if (json.RootElement.TryGetProperty("addons", out var addons))
            {
                foreach (var addon in addons.EnumerateArray())
                {
                    var type = addon.TryGetProperty("type", out var typeProp) 
                        ? typeProp.GetString() 
                        : "";
                    
                    // Only include extensions, not themes/plugins
                    if (type != "extension") continue;

                    extensions.Add(new
                    {
                        id = addon.TryGetProperty("id", out var idProp) ? idProp.GetString() : null,
                        name = addon.TryGetProperty("defaultLocale", out var locale) 
                            && locale.TryGetProperty("name", out var nameProp) 
                                ? nameProp.GetString() 
                                : null,
                        version = addon.TryGetProperty("version", out var versionProp) 
                            ? versionProp.GetString() 
                            : null,
                        active = addon.TryGetProperty("active", out var activeProp) 
                            && activeProp.GetBoolean()
                    });
                }
            }
        }
        catch
        {
            return new { error = "Failed to parse extensions.json" };
        }

        return extensions;
    }

    private static int CountSqliteRows(string dbPath, string tableName)
    {
        try
        {
            // Copy to temp to avoid locking issues with browser
            var tempPath = Path.Combine(Path.GetTempPath(), $"openclaw_{Guid.NewGuid()}.db");
            File.Copy(dbPath, tempPath, true);

            try
            {
                using var conn = new SQLiteConnection($"Data Source={tempPath};Read Only=True;");
                conn.Open();
                using var cmd = new SQLiteCommand($"SELECT COUNT(*) FROM {tableName}", conn);
                var result = cmd.ExecuteScalar();
                return Convert.ToInt32(result);
            }
            finally
            {
                try { File.Delete(tempPath); } catch { }
            }
        }
        catch
        {
            return -1; // Error indicator
        }
    }

    private static int CountBookmarks(string bookmarksPath)
    {
        try
        {
            var json = JsonDocument.Parse(File.ReadAllText(bookmarksPath));
            return CountBookmarksRecursive(json.RootElement);
        }
        catch
        {
            return -1;
        }
    }

    private static int CountBookmarksRecursive(JsonElement element)
    {
        int count = 0;

        if (element.TryGetProperty("type", out var typeProp) && typeProp.GetString() == "url")
        {
            count++;
        }

        if (element.TryGetProperty("children", out var children))
        {
            foreach (var child in children.EnumerateArray())
            {
                count += CountBookmarksRecursive(child);
            }
        }

        if (element.TryGetProperty("roots", out var roots))
        {
            foreach (var prop in roots.EnumerateObject())
            {
                count += CountBookmarksRecursive(prop.Value);
            }
        }

        return count;
    }
}
