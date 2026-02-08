using System.Data.SQLite;
using System.Text.Json;

namespace OpenClawAgent.Service.Inventory;

/// <summary>
/// Collects browser data (Chrome, Firefox, Edge) from ALL user profiles on the system
/// </summary>
public static class BrowserCollector
{
    public static async Task<BrowserResult> CollectAsync(string? browser = null, bool includeCookies = true)
    {
        var results = new BrowserResult();

        // Get all user profile directories
        var userProfiles = GetAllUserProfiles();
        
        foreach (var userProfile in userProfiles)
        {
            var userData = new UserBrowserData
            {
                Username = Path.GetFileName(userProfile),
                UserProfilePath = userProfile
            };

            if (browser == null || browser == "chrome")
            {
                var chromePath = Path.Combine(userProfile, "AppData", "Local", "Google", "Chrome", "User Data");
                userData.Chrome = await CollectChromiumAsync(chromePath, includeCookies);
            }
            
            if (browser == null || browser == "edge")
            {
                var edgePath = Path.Combine(userProfile, "AppData", "Local", "Microsoft", "Edge", "User Data");
                userData.Edge = await CollectChromiumAsync(edgePath, includeCookies);
            }
            
            if (browser == null || browser == "firefox")
            {
                var firefoxPath = Path.Combine(userProfile, "AppData", "Roaming", "Mozilla", "Firefox");
                userData.Firefox = await CollectFirefoxAsync(firefoxPath, includeCookies);
            }

            // Only add if at least one browser found
            if (userData.Chrome?.Installed == true || 
                userData.Edge?.Installed == true || 
                userData.Firefox?.Installed == true)
            {
                results.Users.Add(userData);
            }
        }

        return results;
    }

    /// <summary>
    /// Get all user profile directories on the system
    /// </summary>
    private static List<string> GetAllUserProfiles()
    {
        var profiles = new List<string>();
        
        // Try C:\Users first (most common)
        var usersDir = @"C:\Users";
        if (Directory.Exists(usersDir))
        {
            var excludedDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "Public", "Default", "Default User", "All Users"
            };

            foreach (var userDir in Directory.GetDirectories(usersDir))
            {
                var dirName = Path.GetFileName(userDir);
                if (!excludedDirs.Contains(dirName) && 
                    !dirName.StartsWith(".") &&
                    Directory.Exists(Path.Combine(userDir, "AppData")))
                {
                    profiles.Add(userDir);
                }
            }
        }

        return profiles;
    }

    public class BrowserResult
    {
        public List<UserBrowserData> Users { get; set; } = new();
    }

    public class UserBrowserData
    {
        public string Username { get; set; } = "";
        public string UserProfilePath { get; set; } = "";
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
        public List<CookieInfo>? Cookies { get; set; }
    }

    public class ExtensionData
    {
        public string? Id { get; set; }
        public string? Name { get; set; }
        public string? Version { get; set; }
        public string? Description { get; set; }
        public bool? Active { get; set; }
    }

    public class CookieInfo
    {
        public string Domain { get; set; } = "";
        public string Name { get; set; } = "";
        public string Path { get; set; } = "/";
        public DateTime? ExpiresUtc { get; set; }
        public bool IsSecure { get; set; }
        public bool IsHttpOnly { get; set; }
        public string? SameSite { get; set; }
        public bool IsSession { get; set; }
        public bool IsExpired { get; set; }
    }

    private static Task<BrowserData> CollectChromiumAsync(string userDataPath, bool includeCookies)
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

                // Cookies (from SQLite)
                var cookiesDb = Path.Combine(profileDir, "Network", "Cookies");
                if (!File.Exists(cookiesDb))
                    cookiesDb = Path.Combine(profileDir, "Cookies");
                
                if (File.Exists(cookiesDb))
                {
                    profileData.CookiesCount = CountSqliteRows(cookiesDb, "cookies");
                    if (includeCookies)
                    {
                        profileData.Cookies = GetChromiumCookies(cookiesDb);
                    }
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

    private static List<CookieInfo> GetChromiumCookies(string dbPath)
    {
        var cookies = new List<CookieInfo>();
        
        try
        {
            // Copy to temp to avoid locking issues
            var tempPath = Path.Combine(Path.GetTempPath(), $"openclaw_cookies_{Guid.NewGuid()}.db");
            File.Copy(dbPath, tempPath, true);

            try
            {
                using var conn = new SQLiteConnection($"Data Source={tempPath};Read Only=True;");
                conn.Open();
                
                // Chrome stores expires_utc as microseconds since 1601-01-01
                // We convert to DateTime
                using var cmd = new SQLiteCommand(@"
                    SELECT 
                        host_key,
                        name,
                        path,
                        expires_utc,
                        is_secure,
                        is_httponly,
                        samesite,
                        is_persistent
                    FROM cookies
                    ORDER BY host_key, name
                    LIMIT 5000
                ", conn);

                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var expiresUtc = reader.GetInt64(3);
                    DateTime? expires = null;
                    bool isExpired = false;
                    bool isSession = reader.GetInt32(7) == 0;

                    if (expiresUtc > 0 && !isSession)
                    {
                        // Chrome epoch: microseconds since 1601-01-01
                        try
                        {
                            expires = new DateTime(1601, 1, 1, 0, 0, 0, DateTimeKind.Utc)
                                .AddTicks(expiresUtc * 10);
                            isExpired = expires < DateTime.UtcNow;
                        }
                        catch
                        {
                            // Invalid date
                        }
                    }

                    var sameSiteValue = reader.GetInt32(6);
                    string? sameSite = sameSiteValue switch
                    {
                        0 => "None",
                        1 => "Lax",
                        2 => "Strict",
                        _ => null
                    };

                    cookies.Add(new CookieInfo
                    {
                        Domain = reader.GetString(0),
                        Name = reader.GetString(1),
                        Path = reader.GetString(2),
                        ExpiresUtc = expires,
                        IsSecure = reader.GetInt32(4) == 1,
                        IsHttpOnly = reader.GetInt32(5) == 1,
                        SameSite = sameSite,
                        IsSession = isSession,
                        IsExpired = isExpired
                    });
                }
            }
            finally
            {
                try { File.Delete(tempPath); } catch { }
            }
        }
        catch (Exception ex)
        {
            // Return empty list with error indicator
            cookies.Add(new CookieInfo { Domain = "ERROR", Name = ex.Message });
        }

        return cookies;
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

    private static Task<BrowserData> CollectFirefoxAsync(string firefoxPath, bool includeCookies)
    {
        return Task.Run(() =>
        {
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
                        profiles.Add(CollectFirefoxProfile(fullPath, Path.GetFileName(fullPath), includeCookies));
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
                    profiles.Add(CollectFirefoxProfile(fullPath, Path.GetFileName(fullPath), includeCookies));
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

    private static ProfileData CollectFirefoxProfile(string profilePath, string profileName, bool includeCookies)
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
            if (includeCookies)
            {
                profileData.Cookies = GetFirefoxCookies(cookiesDb);
            }
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

    private static List<CookieInfo> GetFirefoxCookies(string dbPath)
    {
        var cookies = new List<CookieInfo>();
        
        try
        {
            var tempPath = Path.Combine(Path.GetTempPath(), $"openclaw_ff_cookies_{Guid.NewGuid()}.db");
            File.Copy(dbPath, tempPath, true);

            try
            {
                using var conn = new SQLiteConnection($"Data Source={tempPath};Read Only=True;");
                conn.Open();
                
                // Firefox stores expiry as Unix timestamp in seconds
                using var cmd = new SQLiteCommand(@"
                    SELECT 
                        host,
                        name,
                        path,
                        expiry,
                        isSecure,
                        isHttpOnly,
                        sameSite
                    FROM moz_cookies
                    ORDER BY host, name
                    LIMIT 5000
                ", conn);

                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var expiry = reader.GetInt64(3);
                    DateTime? expires = null;
                    bool isExpired = false;
                    bool isSession = expiry == 0;

                    if (expiry > 0)
                    {
                        expires = DateTimeOffset.FromUnixTimeSeconds(expiry).UtcDateTime;
                        isExpired = expires < DateTime.UtcNow;
                    }

                    var sameSiteValue = reader.GetInt32(6);
                    string? sameSite = sameSiteValue switch
                    {
                        0 => "None",
                        1 => "Lax",
                        2 => "Strict",
                        _ => null
                    };

                    cookies.Add(new CookieInfo
                    {
                        Domain = reader.GetString(0),
                        Name = reader.GetString(1),
                        Path = reader.GetString(2),
                        ExpiresUtc = expires,
                        IsSecure = reader.GetInt32(4) == 1,
                        IsHttpOnly = reader.GetInt32(5) == 1,
                        SameSite = sameSite,
                        IsSession = isSession,
                        IsExpired = isExpired
                    });
                }
            }
            finally
            {
                try { File.Delete(tempPath); } catch { }
            }
        }
        catch (Exception ex)
        {
            cookies.Add(new CookieInfo { Domain = "ERROR", Name = ex.Message });
        }

        return cookies;
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
