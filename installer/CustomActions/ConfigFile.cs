using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Web.Script.Serialization;

namespace OctofleetAgent.Installer.CustomActions
{
    /// <summary>
    /// Builds service-config.json from the MSI properties. An existing config is kept: only the
    /// properties passed to msiexec replace their keys, everything else (node settings, the
    /// encrypted agent key) stays. Like Install-OctofleetAgent.ps1, the agent key is written in
    /// plain text; the service encrypts it for SYSTEM when it starts (AgentKeyProtection).
    /// No Windows Installer types here, so the tests can run this directly.
    /// </summary>
    public static class ConfigFile
    {
        public const string FileName = "service-config.json";

        /// <summary>
        /// Returns the new file content. <paramref name="existingJson"/> is the current file
        /// (null if there is none); a file that is not a JSON object is replaced
        /// (<paramref name="replacedInvalid"/>). Throws ArgumentException for invalid values.
        /// </summary>
        public static string Merge(string existingJson, string serverUrl, string apiKey, string displayName,
            string pushInterval, out bool replacedInvalid)
        {
            var config = Parse(existingJson, out replacedInvalid);

            if (!string.IsNullOrWhiteSpace(serverUrl))
            {
                var url = serverUrl.Trim().TrimEnd('/');
                Uri uri;
                if (!Uri.TryCreate(url, UriKind.Absolute, out uri) ||
                    (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
                    throw new ArgumentException("SERVER_URL must be an http:// or https:// URL, e.g. https://octofleet.example.com");
                Set(config, "InventoryApiUrl", url);
            }

            if (!string.IsNullOrWhiteSpace(apiKey))
            {
                Set(config, "InventoryApiKey", apiKey.Trim());
                // The new key replaces the encrypted one; the service encrypts it again
                Remove(config, "InventoryApiKeyProtected");
            }

            if (!string.IsNullOrWhiteSpace(displayName))
                Set(config, "DisplayName", displayName.Trim());

            if (!string.IsNullOrWhiteSpace(pushInterval))
            {
                int minutes;
                if (!int.TryParse(pushInterval.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out minutes) || minutes < 1)
                    throw new ArgumentException("PUSH_INTERVAL must be a whole number of minutes (1 or more)");
                Set(config, "ScheduledPushIntervalMinutes", minutes);
            }

            return new JavaScriptSerializer().Serialize(config);
        }

        private static Dictionary<string, object> Parse(string json, out bool invalid)
        {
            invalid = false;
            if (string.IsNullOrWhiteSpace(json))
                return new Dictionary<string, object>();
            try
            {
                var parsed = new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
                if (parsed != null)
                    return parsed;
            }
            catch (ArgumentException)
            {
                // not JSON
            }
            catch (InvalidOperationException)
            {
                // not JSON
            }
            invalid = true;
            return new Dictionary<string, object>();
        }

        /// <summary>Sets a key; the agent reads the keys case-insensitively, so other spellings are replaced.</summary>
        private static void Set(Dictionary<string, object> config, string key, object value)
        {
            foreach (var other in config.Keys.Where(k => k != key && string.Equals(k, key, StringComparison.OrdinalIgnoreCase)).ToList())
                config.Remove(other);
            config[key] = value;
        }

        private static void Remove(Dictionary<string, object> config, string key)
        {
            foreach (var match in config.Keys.Where(k => string.Equals(k, key, StringComparison.OrdinalIgnoreCase)).ToList())
                config.Remove(match);
        }
    }
}
