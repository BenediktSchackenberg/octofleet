using System.Data.SQLite;
using System.Text.Json;

namespace OpenClawAgent.Service.Inventory;

/// <summary>
/// Collects browser data (Chrome, Firefox, Edge)
/// </summary>
public static class BrowserCollector
{
    public static async Task<BrowserResult> CollectAsync(string? browser = null)
    {
        var results = new BrowserResult();

        if (browser == null || browser == "chrome")
            results.Chrome = await CollectChromeAsync();
        
        if (browser == null || browser == "edge")
            results.Edge = await CollectEdgeAsync();
        
        if (browser == null || browser == "firefox")
            results.Firefox = await CollectFirefoxAsync();

        return results;
    }

    public class BrowserResult
    {
        public BrowserData? Chrome { get; set; }
        public BrowserData? Edge { get; set; }
        public BrowserData? Firefox { get; set; }
    }

    public class BrowserData
    {
        public bool Installed { get; set; }
        public int ProfileCount { get; set; }
        public List<ProfileData> Profiles { get; set; } = new();
    }

    public class ProfileData
    {
        public string Name { get; set; } = "";
        public List<ExtensionData>? Extensions { get; set; }
        public int CookiesCount { get; set; }
        public int HistoryCount { get; set; }
        public int LoginsCount { get; set; }
        public int BookmarksCount { get; set; }
    }

    public class ExtensionData
    {
        public string? Id { get; set; }
        public string? Name { get; set; }
        public string? Version { get; set; }
        public string? Description { get; set; }
        public bool? Active { get; set; }
    }

    private static Task<BrowserData> CollectChromeAsync()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var chromePath = Path.Combine(localAppData, "Google", "Chrome", "User Data");
        
        return CollectChromiumAsync(chromePath);
    }

    private static Task<BrowserData> CollectEdgeAsync()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var edgePath = Path.Combine(localAppData, "Microsoft", "Edge", "User Data");
        
        return CollectChromiumAsync(edgePath);
    }

    private static Task<BrowserData> CollectChromiumAsync(string userDataPath)
    {
        return Task.Run(() =>
        {
            if (!Directory.Exists(userDataPath))
                return new BrowserData { Installed = false };

            var profiles = new List<ProfileData>();
            
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
                var profileData = new ProfileData { Name = profileName };

                // Extensions
                var extensionsDir = Path.Combine(profileDir, "Extensions");
                if (Directory.Exists(extensionsDir))
                {
                    profileData.Extensions = GetChromiumExtensions(extensionsDir);
                }

                // Cookies count (from SQLite)
                var cookiesDb = Path.Combine(profileDir, "Network", "Cookies");
                if (!File.Exists(cookiesDb))
                    cookiesDb = Path.Combine(profileDir, "Cookies");
                
                if (File.Exists(cookiesDb))
                {
                    profileData.CookiesCount = CountSqliteRows(cookiesDb, "cookies");
                }

                // History count
                var historyDb = Path.Combine(profileDir, "History");
                if (File.Exists(historyDb))
                {
                    profileData.HistoryCount = CountSqliteRows(historyDb, "urls");
                }

                // Login Data count
                var loginDb = Path.Combine(profileDir, "Login Data");
                if (File.Exists(loginDb))
                {
                    profileData.LoginsCount = CountSqliteRows(loginDb, "logins");
                }

                // Bookmarks count
                var bookmarksFile = Path.Combine(profileDir, "Bookmarks");
                if (File.Exists(bookmarksFile))
                {
                    profileData.BookmarksCount = CountBookmarks(bookmarksFile);
                }

                profiles.Add(profileData);
            }

            return new BrowserData
            {
                Installed = true,
                ProfileCount = profiles.Count,
                Profiles = profiles
            };
        });
    }

    private static List<ExtensionData> GetChromiumExtensions(string extensionsDir)
    {
        var extensions = new List<ExtensionData>();

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

                    extensions.Add(new ExtensionData
                    {
                        Id = extId,
                        Name = name,
                        Version = version,
                        Description = description?.Length > 100 
                            ? description.Substring(0, 100) + "..." 
                            : description
                    });
                }
                catch
                {
                    extensions.Add(new ExtensionData { Id = extId, Name = extId });
                }
            }
        }
        catch
        {
            // Failed to enumerate extensions
        }

        return extensions;
    }

    private static Task<BrowserData> CollectFirefoxAsync()
    {
        return Task.Run(() =>
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var firefoxPath = Path.Combine(appData, "Mozilla", "Firefox");
            var profilesIni = Path.Combine(firefoxPath, "profiles.ini");

            if (!File.Exists(profilesIni))
                return new BrowserData { Installed = false };

            var profiles = new List<ProfileData>();

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

            return new BrowserData
            {
                Installed = true,
                ProfileCount = profiles.Count,
                Profiles = profiles
            };
        });
    }

    private static ProfileData CollectFirefoxProfile(string profilePath, string profileName)
    {
        var profileData = new ProfileData { Name = profileName };

        // Extensions
        var extensionsJson = Path.Combine(profilePath, "extensions.json");
        if (File.Exists(extensionsJson))
        {
            profileData.Extensions = GetFirefoxExtensions(extensionsJson);
        }

        // Cookies
        var cookiesDb = Path.Combine(profilePath, "cookies.sqlite");
        if (File.Exists(cookiesDb))
        {
            profileData.CookiesCount = CountSqliteRows(cookiesDb, "moz_cookies");
        }

        // History
        var placesDb = Path.Combine(profilePath, "places.sqlite");
        if (File.Exists(placesDb))
        {
            profileData.HistoryCount = CountSqliteRows(placesDb, "moz_places");
            profileData.BookmarksCount = CountSqliteRows(placesDb, "moz_bookmarks");
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
                    profileData.LoginsCount = logins.GetArrayLength();
                }
            }
            catch
            {
                profileData.LoginsCount = -1;
            }
        }

        return profileData;
    }

    private static List<ExtensionData> GetFirefoxExtensions(string extensionsJsonPath)
    {
        var extensions = new List<ExtensionData>();

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

                    extensions.Add(new ExtensionData
                    {
                        Id = addon.TryGetProperty("id", out var idProp) ? idProp.GetString() : null,
                        Name = addon.TryGetProperty("defaultLocale", out var locale) 
                            && locale.TryGetProperty("name", out var nameProp) 
                                ? nameProp.GetString() 
                                : null,
                        Version = addon.TryGetProperty("version", out var versionProp) 
                            ? versionProp.GetString() 
                            : null,
                        Active = addon.TryGetProperty("active", out var activeProp) 
                            && activeProp.GetBoolean()
                    });
                }
            }
        }
        catch
        {
            // Failed to parse extensions.json
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
