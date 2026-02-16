using System.Data.SQLite;
using System.Text.Json;
using System.Diagnostics;

namespace OctofleetAgent.Service.Inventory;

/// <summary>
/// Collects browser data (Chrome, Firefox, Edge) from ALL user profiles on the system
/// </summary>
public static class BrowserCollector
{
    // Critical domains that contain sensitive auth/session data
    private static readonly HashSet<string> CriticalDomains = new(StringComparer.OrdinalIgnoreCase)
    {
        // Banking & Finance
        ".paypal.com", "paypal.com",
        ".stripe.com", "stripe.com",
        ".coinbase.com", "coinbase.com",
        ".binance.com", "binance.com",
        ".kraken.com", "kraken.com",
        
        // Auth Providers
        ".google.com", "google.com", "accounts.google.com",
        ".microsoft.com", "microsoft.com", "login.microsoftonline.com", "login.live.com",
        ".github.com", "github.com",
        ".gitlab.com", "gitlab.com",
        ".okta.com", "okta.com",
        ".auth0.com", "auth0.com",
        ".onelogin.com", "onelogin.com",
        
        // Cloud Providers
        ".aws.amazon.com", "console.aws.amazon.com",
        ".azure.com", "portal.azure.com",
        ".cloud.google.com", "console.cloud.google.com",
        
        // Social / Communication
        ".discord.com", "discord.com",
        ".slack.com", "slack.com",
        ".facebook.com", "facebook.com",
        ".twitter.com", "twitter.com", ".x.com", "x.com",
        ".linkedin.com", "linkedin.com",
        ".telegram.org", "telegram.org", "web.telegram.org",
        ".whatsapp.com", "web.whatsapp.com",
        
        // Email
        ".mail.google.com", "mail.google.com",
        ".outlook.com", "outlook.com", "outlook.live.com",
        ".protonmail.com", "protonmail.com", "mail.proton.me",
        
        // Dev Tools
        ".npmjs.com", "npmjs.com",
        ".docker.com", "hub.docker.com",
        ".vercel.com", "vercel.com",
        ".netlify.com", "netlify.com",
        ".heroku.com", "heroku.com",
        
        // Password Managers
        ".1password.com", "1password.com",
        ".lastpass.com", "lastpass.com",
        ".bitwarden.com", "bitwarden.com",
        ".dashlane.com", "dashlane.com"
    };

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
                userData.Chrome = await CollectChromiumAsync(chromePath, "Chrome", includeCookies);
            }
            
            if (browser == null || browser == "edge")
            {
                var edgePath = Path.Combine(userProfile, "AppData", "Local", "Microsoft", "Edge", "User Data");
                userData.Edge = await CollectChromiumAsync(edgePath, "Edge", includeCookies);
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

    #region Data Classes

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
        public string? Error { get; set; }
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
        public int CriticalCookiesCount { get; set; }
        public string? CookieError { get; set; }
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
        public bool IsCritical { get; set; }
        public string? CriticalCategory { get; set; }
    }

    #endregion

    private static Task<BrowserData> CollectChromiumAsync(string userDataPath, string browserName, bool includeCookies)
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

                // Cookies (from SQLite) - try multiple methods
                var cookiesDb = Path.Combine(profileDir, "Network", "Cookies");
                if (!File.Exists(cookiesDb))
                    cookiesDb = Path.Combine(profileDir, "Cookies");
                
                if (File.Exists(cookiesDb))
                {
                    var cookieResult = GetChromiumCookiesWithRetry(cookiesDb, browserName);
                    profileData.CookiesCount = cookieResult.Count;
                    profileData.CookieError = cookieResult.Error;
                    
                    if (includeCookies && cookieResult.Cookies != null)
                    {
                        profileData.Cookies = cookieResult.Cookies;
                        profileData.CriticalCookiesCount = cookieResult.Cookies.Count(c => c.IsCritical);
                    }
                }

                // History count
                var historyDb = Path.Combine(profileDir, "History");
                if (File.Exists(historyDb))
                {
                    profileData.HistoryCount = CountSqliteRowsWithCopy(historyDb, "urls");
                }

                // Login Data count
                var loginDb = Path.Combine(profileDir, "Login Data");
                if (File.Exists(loginDb))
                {
                    profileData.LoginsCount = CountSqliteRowsWithCopy(loginDb, "logins");
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

    private class CookieCollectionResult
    {
        public List<CookieInfo>? Cookies { get; set; }
        public int Count { get; set; }
        public string? Error { get; set; }
    }

    private static CookieCollectionResult GetChromiumCookiesWithRetry(string dbPath, string browserName)
    {
        // Method 1: Direct copy (works if browser is closed)
        var result = TryGetChromiumCookies(dbPath);
        if (result.Cookies != null && result.Count > 0)
            return result;

        // Method 2: Try using Volume Shadow Copy (VSS) for locked files
        // This requires admin rights which we have as SYSTEM
        var vssResult = TryGetCookiesViaVSS(dbPath, browserName);
        if (vssResult.Cookies != null && vssResult.Count > 0)
            return vssResult;

        // Method 3: Try reading with SQLite WAL mode workaround
        var walResult = TryGetCookiesWithWAL(dbPath);
        if (walResult.Cookies != null && walResult.Count > 0)
            return walResult;

        return new CookieCollectionResult 
        { 
            Count = -1, 
            Error = $"Could not read cookies - {browserName} may be running and locking the database" 
        };
    }

    private static CookieCollectionResult TryGetChromiumCookies(string dbPath)
    {
        var cookies = new List<CookieInfo>();
        
        try
        {
            var tempPath = Path.Combine(Path.GetTempPath(), $"octofleet_cookies_{Guid.NewGuid()}.db");
            
            // Try to copy - this fails if browser has exclusive lock
            try
            {
                File.Copy(dbPath, tempPath, true);
            }
            catch (IOException)
            {
                return new CookieCollectionResult { Count = -1, Error = "Database locked by browser" };
            }

            try
            {
                using var conn = new SQLiteConnection($"Data Source={tempPath};Read Only=True;");
                conn.Open();
                
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
                    LIMIT 10000
                ", conn);

                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var domain = reader.GetString(0);
                    var expiresUtc = reader.GetInt64(3);
                    DateTime? expires = null;
                    bool isExpired = false;
                    bool isSession = reader.GetInt32(7) == 0;

                    if (expiresUtc > 0 && !isSession)
                    {
                        try
                        {
                            // Chrome epoch: microseconds since 1601-01-01
                            expires = new DateTime(1601, 1, 1, 0, 0, 0, DateTimeKind.Utc)
                                .AddTicks(expiresUtc * 10);
                            isExpired = expires < DateTime.UtcNow;
                        }
                        catch { }
                    }

                    var sameSiteValue = reader.GetInt32(6);
                    string? sameSite = sameSiteValue switch
                    {
                        0 => "None",
                        1 => "Lax",
                        2 => "Strict",
                        _ => null
                    };

                    var (isCritical, category) = CheckCriticalDomain(domain);

                    cookies.Add(new CookieInfo
                    {
                        Domain = domain,
                        Name = reader.GetString(1),
                        Path = reader.GetString(2),
                        ExpiresUtc = expires,
                        IsSecure = reader.GetInt32(4) == 1,
                        IsHttpOnly = reader.GetInt32(5) == 1,
                        SameSite = sameSite,
                        IsSession = isSession,
                        IsExpired = isExpired,
                        IsCritical = isCritical,
                        CriticalCategory = category
                    });
                }

                return new CookieCollectionResult { Cookies = cookies, Count = cookies.Count };
            }
            finally
            {
                try { File.Delete(tempPath); } catch { }
            }
        }
        catch (Exception ex)
        {
            return new CookieCollectionResult { Count = -1, Error = ex.Message };
        }
    }

    private static CookieCollectionResult TryGetCookiesViaVSS(string dbPath, string browserName)
    {
        string? tempDb = null;
        try
        {
            // Use VssHelper to copy locked file via VSS or esentutl
            tempDb = VssHelper.CopySqliteDatabaseAsync(dbPath).GetAwaiter().GetResult();
            
            if (tempDb == null || !File.Exists(tempDb))
                return new CookieCollectionResult { Count = -1, Error = "VSS copy failed" };

            var cookies = new List<CookieInfo>();
            
            using var conn = new SQLiteConnection($"Data Source={tempDb};Read Only=True;");
            conn.Open();
            
            using var cmd = new SQLiteCommand(@"
                SELECT 
                    host_key, name, path, expires_utc, is_secure, 
                    is_httponly, samesite, is_persistent
                FROM cookies
                ORDER BY host_key, name
                LIMIT 10000
            ", conn);

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var domain = reader.GetString(0);
                var expiresUtc = reader.GetInt64(3);
                DateTime? expires = null;
                bool isExpired = false;
                bool isSession = reader.GetInt32(7) == 0;

                if (expiresUtc > 0 && !isSession)
                {
                    try
                    {
                        expires = new DateTime(1601, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddTicks(expiresUtc * 10);
                        isExpired = expires < DateTime.UtcNow;
                    }
                    catch { }
                }

                var (isCritical, category) = CheckCriticalDomain(domain);

                cookies.Add(new CookieInfo
                {
                    Domain = domain,
                    Name = reader.GetString(1),
                    Path = reader.GetString(2),
                    ExpiresUtc = expires,
                    IsSecure = reader.GetInt32(4) == 1,
                    IsHttpOnly = reader.GetInt32(5) == 1,
                    SameSite = reader.GetInt32(6) switch { 0 => "None", 1 => "Lax", 2 => "Strict", _ => null },
                    IsSession = isSession,
                    IsExpired = isExpired,
                    IsCritical = isCritical,
                    CriticalCategory = category
                });
            }

            return new CookieCollectionResult { Cookies = cookies, Count = cookies.Count };
        }
        catch (Exception ex)
        {
            return new CookieCollectionResult { Count = -1, Error = $"VSS failed: {ex.Message}" };
        }
        finally
        {
            VssHelper.CleanupTempDatabase(tempDb);
        }
    }

    private static CookieCollectionResult TryGetCookiesWithWAL(string dbPath)
    {
        var cookies = new List<CookieInfo>();
        var tempDir = Path.Combine(Path.GetTempPath(), $"octofleet_wal_{Guid.NewGuid()}");
        
        try
        {
            Directory.CreateDirectory(tempDir);
            
            var tempDb = Path.Combine(tempDir, "Cookies");
            var walFile = dbPath + "-wal";
            var shmFile = dbPath + "-shm";
            
            // Copy all related files
            try
            {
                File.Copy(dbPath, tempDb, true);
                if (File.Exists(walFile))
                    File.Copy(walFile, tempDb + "-wal", true);
                if (File.Exists(shmFile))
                    File.Copy(shmFile, tempDb + "-shm", true);
            }
            catch (IOException)
            {
                return new CookieCollectionResult { Count = -1, Error = "WAL copy failed - files locked" };
            }

            using var conn = new SQLiteConnection($"Data Source={tempDb};Read Only=True;Journal Mode=WAL;");
            conn.Open();
            
            // Checkpoint the WAL to merge changes
            try
            {
                using var checkpointCmd = new SQLiteCommand("PRAGMA wal_checkpoint(PASSIVE);", conn);
                checkpointCmd.ExecuteNonQuery();
            }
            catch { }

            using var cmd = new SQLiteCommand(@"
                SELECT host_key, name, path, expires_utc, is_secure, is_httponly, samesite, is_persistent
                FROM cookies ORDER BY host_key, name LIMIT 10000
            ", conn);

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var domain = reader.GetString(0);
                var expiresUtc = reader.GetInt64(3);
                DateTime? expires = null;
                bool isExpired = false;
                bool isSession = reader.GetInt32(7) == 0;

                if (expiresUtc > 0 && !isSession)
                {
                    try
                    {
                        expires = new DateTime(1601, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddTicks(expiresUtc * 10);
                        isExpired = expires < DateTime.UtcNow;
                    }
                    catch { }
                }

                var (isCritical, category) = CheckCriticalDomain(domain);

                cookies.Add(new CookieInfo
                {
                    Domain = domain,
                    Name = reader.GetString(1),
                    Path = reader.GetString(2),
                    ExpiresUtc = expires,
                    IsSecure = reader.GetInt32(4) == 1,
                    IsHttpOnly = reader.GetInt32(5) == 1,
                    SameSite = reader.GetInt32(6) switch { 0 => "None", 1 => "Lax", 2 => "Strict", _ => null },
                    IsSession = isSession,
                    IsExpired = isExpired,
                    IsCritical = isCritical,
                    CriticalCategory = category
                });
            }

            return new CookieCollectionResult { Cookies = cookies, Count = cookies.Count };
        }
        catch (Exception ex)
        {
            return new CookieCollectionResult { Count = -1, Error = $"WAL read failed: {ex.Message}" };
        }
        finally
        {
            try { Directory.Delete(tempDir, true); } catch { }
        }
    }

    private static (bool IsCritical, string? Category) CheckCriticalDomain(string domain)
    {
        var normalizedDomain = domain.TrimStart('.');
        
        // Check exact match first
        if (CriticalDomains.Contains(domain) || CriticalDomains.Contains(normalizedDomain))
        {
            return (true, GetDomainCategory(normalizedDomain));
        }

        // Check if it's a subdomain of a critical domain
        foreach (var criticalDomain in CriticalDomains)
        {
            var normalized = criticalDomain.TrimStart('.');
            if (normalizedDomain.EndsWith("." + normalized) || normalizedDomain == normalized)
            {
                return (true, GetDomainCategory(normalized));
            }
        }

        return (false, null);
    }

    private static string GetDomainCategory(string domain)
    {
        if (domain.Contains("paypal") || domain.Contains("stripe") || 
            domain.Contains("coinbase") || domain.Contains("binance") || domain.Contains("kraken"))
            return "Banking/Finance";
        
        if (domain.Contains("google") || domain.Contains("microsoft") || 
            domain.Contains("github") || domain.Contains("okta") || domain.Contains("auth0"))
            return "Auth Provider";
        
        if (domain.Contains("aws") || domain.Contains("azure") || domain.Contains("cloud.google"))
            return "Cloud Provider";
        
        if (domain.Contains("discord") || domain.Contains("slack") || 
            domain.Contains("telegram") || domain.Contains("whatsapp"))
            return "Communication";
        
        if (domain.Contains("mail") || domain.Contains("outlook") || domain.Contains("proton"))
            return "Email";
        
        if (domain.Contains("1password") || domain.Contains("lastpass") || 
            domain.Contains("bitwarden") || domain.Contains("dashlane"))
            return "Password Manager";
        
        return "Sensitive";
    }

    private static List<ExtensionData> GetChromiumExtensions(string extensionsDir)
    {
        var extensions = new List<ExtensionData>();

        try
        {
            foreach (var extDir in Directory.GetDirectories(extensionsDir))
            {
                var extId = Path.GetFileName(extDir);
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

                    var name = root.TryGetProperty("name", out var nameProp) ? nameProp.GetString() : extId;
                    var version = root.TryGetProperty("version", out var versionProp) ? versionProp.GetString() : "unknown";
                    var description = root.TryGetProperty("description", out var descProp) ? descProp.GetString() : null;

                    if (name?.StartsWith("__MSG_") == true) name = extId;

                    extensions.Add(new ExtensionData
                    {
                        Id = extId,
                        Name = name,
                        Version = version,
                        Description = description?.Length > 100 ? description.Substring(0, 100) + "..." : description
                    });
                }
                catch
                {
                    extensions.Add(new ExtensionData { Id = extId, Name = extId });
                }
            }
        }
        catch { }

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
            var lines = File.ReadAllLines(profilesIni);
            string? currentPath = null;
            bool isRelative = true;

            foreach (var line in lines)
            {
                if (line.StartsWith("Path="))
                    currentPath = line.Substring(5);
                else if (line.StartsWith("IsRelative="))
                    isRelative = line.Substring(11) == "1";
                else if (line.StartsWith("[") && currentPath != null)
                {
                    var fullPath = isRelative ? Path.Combine(firefoxPath, currentPath) : currentPath;
                    if (Directory.Exists(fullPath))
                        profiles.Add(CollectFirefoxProfile(fullPath, Path.GetFileName(fullPath), includeCookies));
                    currentPath = null;
                    isRelative = true;
                }
            }

            if (currentPath != null)
            {
                var fullPath = isRelative ? Path.Combine(firefoxPath, currentPath) : currentPath;
                if (Directory.Exists(fullPath))
                    profiles.Add(CollectFirefoxProfile(fullPath, Path.GetFileName(fullPath), includeCookies));
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

        var extensionsJson = Path.Combine(profilePath, "extensions.json");
        if (File.Exists(extensionsJson))
            profileData.Extensions = GetFirefoxExtensions(extensionsJson);

        var cookiesDb = Path.Combine(profilePath, "cookies.sqlite");
        if (File.Exists(cookiesDb))
        {
            var cookieResult = GetFirefoxCookies(cookiesDb);
            profileData.CookiesCount = cookieResult.Count;
            profileData.CookieError = cookieResult.Error;
            if (includeCookies && cookieResult.Cookies != null)
            {
                profileData.Cookies = cookieResult.Cookies;
                profileData.CriticalCookiesCount = cookieResult.Cookies.Count(c => c.IsCritical);
            }
        }

        var placesDb = Path.Combine(profilePath, "places.sqlite");
        if (File.Exists(placesDb))
        {
            profileData.HistoryCount = CountSqliteRowsWithCopy(placesDb, "moz_places");
            profileData.BookmarksCount = CountSqliteRowsWithCopy(placesDb, "moz_bookmarks");
        }

        var loginsJson = Path.Combine(profilePath, "logins.json");
        if (File.Exists(loginsJson))
        {
            try
            {
                var json = JsonDocument.Parse(File.ReadAllText(loginsJson));
                if (json.RootElement.TryGetProperty("logins", out var logins))
                    profileData.LoginsCount = logins.GetArrayLength();
            }
            catch { profileData.LoginsCount = -1; }
        }

        return profileData;
    }

    private static CookieCollectionResult GetFirefoxCookies(string dbPath)
    {
        var cookies = new List<CookieInfo>();
        var tempPath = Path.Combine(Path.GetTempPath(), $"octofleet_ff_cookies_{Guid.NewGuid()}.db");
        
        try
        {
            try { File.Copy(dbPath, tempPath, true); }
            catch (IOException) { return new CookieCollectionResult { Count = -1, Error = "Firefox database locked" }; }

            using var conn = new SQLiteConnection($"Data Source={tempPath};Read Only=True;");
            conn.Open();
            
            using var cmd = new SQLiteCommand(@"
                SELECT host, name, path, expiry, isSecure, isHttpOnly, sameSite
                FROM moz_cookies ORDER BY host, name LIMIT 10000
            ", conn);

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var domain = reader.GetString(0);
                var expiry = reader.GetInt64(3);
                DateTime? expires = null;
                bool isExpired = false;
                bool isSession = expiry == 0;

                if (expiry > 0)
                {
                    expires = DateTimeOffset.FromUnixTimeSeconds(expiry).UtcDateTime;
                    isExpired = expires < DateTime.UtcNow;
                }

                var (isCritical, category) = CheckCriticalDomain(domain);

                cookies.Add(new CookieInfo
                {
                    Domain = domain,
                    Name = reader.GetString(1),
                    Path = reader.GetString(2),
                    ExpiresUtc = expires,
                    IsSecure = reader.GetInt32(4) == 1,
                    IsHttpOnly = reader.GetInt32(5) == 1,
                    SameSite = reader.GetInt32(6) switch { 0 => "None", 1 => "Lax", 2 => "Strict", _ => null },
                    IsSession = isSession,
                    IsExpired = isExpired,
                    IsCritical = isCritical,
                    CriticalCategory = category
                });
            }

            return new CookieCollectionResult { Cookies = cookies, Count = cookies.Count };
        }
        catch (Exception ex)
        {
            return new CookieCollectionResult { Count = -1, Error = ex.Message };
        }
        finally
        {
            try { File.Delete(tempPath); } catch { }
        }
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
                    var type = addon.TryGetProperty("type", out var typeProp) ? typeProp.GetString() : "";
                    if (type != "extension") continue;

                    extensions.Add(new ExtensionData
                    {
                        Id = addon.TryGetProperty("id", out var idProp) ? idProp.GetString() : null,
                        Name = addon.TryGetProperty("defaultLocale", out var locale) 
                            && locale.TryGetProperty("name", out var nameProp) ? nameProp.GetString() : null,
                        Version = addon.TryGetProperty("version", out var versionProp) ? versionProp.GetString() : null,
                        Active = addon.TryGetProperty("active", out var activeProp) && activeProp.GetBoolean()
                    });
                }
            }
        }
        catch { }

        return extensions;
    }

    private static int CountSqliteRowsWithCopy(string dbPath, string tableName)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"octofleet_{Guid.NewGuid()}.db");
        try
        {
            try { File.Copy(dbPath, tempPath, true); }
            catch (IOException) { return -1; }

            using var conn = new SQLiteConnection($"Data Source={tempPath};Read Only=True;");
            conn.Open();
            using var cmd = new SQLiteCommand($"SELECT COUNT(*) FROM {tableName}", conn);
            return Convert.ToInt32(cmd.ExecuteScalar());
        }
        catch { return -1; }
        finally
        {
            try { File.Delete(tempPath); } catch { }
        }
    }

    private static int CountBookmarks(string bookmarksPath)
    {
        try
        {
            var json = JsonDocument.Parse(File.ReadAllText(bookmarksPath));
            return CountBookmarksRecursive(json.RootElement);
        }
        catch { return -1; }
    }

    private static int CountBookmarksRecursive(JsonElement element)
    {
        int count = 0;
        if (element.TryGetProperty("type", out var typeProp) && typeProp.GetString() == "url") count++;
        if (element.TryGetProperty("children", out var children))
            foreach (var child in children.EnumerateArray()) count += CountBookmarksRecursive(child);
        if (element.TryGetProperty("roots", out var roots))
            foreach (var prop in roots.EnumerateObject()) count += CountBookmarksRecursive(prop.Value);
        return count;
    }
}
