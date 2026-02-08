using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using NSec.Cryptography;

namespace OpenClawAgent.Service;

/// <summary>
/// Manages device identity for Gateway authentication using Ed25519.
/// Compatible with OpenClaw Gateway protocol.
/// </summary>
public class DeviceIdentity
{
    private const string KeyFileName = "device-identity.json";
    
    public string Id { get; private set; } = "";
    public string PublicKeyBase64Url { get; private set; } = "";
    private byte[] _privateKeyBytes = Array.Empty<byte>();
    
    /// <summary>
    /// Load or create device identity from config directory.
    /// </summary>
    public static DeviceIdentity LoadOrCreate(string configDir)
    {
        var keyPath = Path.Combine(configDir, KeyFileName);
        var identity = new DeviceIdentity();
        
        if (File.Exists(keyPath))
        {
            try
            {
                var json = File.ReadAllText(keyPath);
                var data = JsonSerializer.Deserialize<DeviceKeyData>(json);
                if (data != null && !string.IsNullOrEmpty(data.PrivateKey) && !string.IsNullOrEmpty(data.PublicKey))
                {
                    identity._privateKeyBytes = Base64UrlDecode(data.PrivateKey);
                    identity.PublicKeyBase64Url = data.PublicKey;
                    identity.Id = data.Id ?? ComputeFingerprint(Base64UrlDecode(data.PublicKey));
                    return identity;
                }
            }
            catch
            {
                // Regenerate on error
            }
        }
        
        // Generate new Ed25519 keypair
        var algorithm = SignatureAlgorithm.Ed25519;
        using var key = Key.Create(algorithm, new KeyCreationParameters { ExportPolicy = KeyExportPolicies.AllowPlaintextExport });
        
        // Export raw keys (Ed25519 public key is 32 bytes, private is 32 bytes seed)
        var privateKeyBytes = key.Export(KeyBlobFormat.RawPrivateKey);
        var publicKeyBytes = key.Export(KeyBlobFormat.RawPublicKey);
        
        identity._privateKeyBytes = privateKeyBytes;
        identity.PublicKeyBase64Url = Base64UrlEncode(publicKeyBytes);
        identity.Id = ComputeFingerprint(publicKeyBytes);
        
        // Save to file
        Directory.CreateDirectory(configDir);
        var keyData = new DeviceKeyData
        {
            Id = identity.Id,
            PublicKey = identity.PublicKeyBase64Url,
            PrivateKey = Base64UrlEncode(privateKeyBytes)
        };
        File.WriteAllText(keyPath, JsonSerializer.Serialize(keyData, new JsonSerializerOptions { WriteIndented = true }));
        
        return identity;
    }
    
    /// <summary>
    /// Create device object for connect request with signed challenge.
    /// </summary>
    public object CreateDeviceObject(string? nonce = null)
    {
        if (string.IsNullOrEmpty(nonce))
        {
            // Local connection without challenge
            return new
            {
                id = Id,
                publicKey = PublicKeyBase64Url
            };
        }
        
        var signedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        
        // Build payload to sign: nonce:signedAt
        var payload = $"{nonce}:{signedAt}";
        var payloadBytes = Encoding.UTF8.GetBytes(payload);
        
        // Sign with Ed25519
        var algorithm = SignatureAlgorithm.Ed25519;
        using var key = Key.Import(algorithm, _privateKeyBytes, KeyBlobFormat.RawPrivateKey);
        var signatureBytes = algorithm.Sign(key, payloadBytes);
        var signature = Base64UrlEncode(signatureBytes);
        
        return new
        {
            id = Id,
            publicKey = PublicKeyBase64Url,
            signature,
            signedAt,
            nonce
        };
    }
    
    private static string ComputeFingerprint(byte[] publicKeyBytes)
    {
        // SHA256 hash of raw public key bytes, as hex
        var hash = SHA256.HashData(publicKeyBytes);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
    
    private static string Base64UrlEncode(byte[] data)
    {
        return Convert.ToBase64String(data)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }
    
    private static byte[] Base64UrlDecode(string base64Url)
    {
        var base64 = base64Url
            .Replace('-', '+')
            .Replace('_', '/');
        
        // Add padding if needed
        switch (base64.Length % 4)
        {
            case 2: base64 += "=="; break;
            case 3: base64 += "="; break;
        }
        
        return Convert.FromBase64String(base64);
    }
    
    private class DeviceKeyData
    {
        public string? Id { get; set; }
        public string? PublicKey { get; set; }
        public string? PrivateKey { get; set; }
    }
}
