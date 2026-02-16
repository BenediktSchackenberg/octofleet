using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Org.BouncyCastle.Crypto.Generators;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Org.BouncyCastle.Security;

namespace OctofleetAgent.Service;

/// <summary>
/// Manages device identity for Gateway authentication using Ed25519.
/// Compatible with Octofleet Gateway protocol.
/// Uses BouncyCastle for pure managed Ed25519 (no native dependencies).
/// </summary>
public class DeviceIdentity
{
    private const string KeyFileName = "device-identity.json";
    
    public string Id { get; private set; } = "";
    public string PublicKeyBase64Url { get; private set; } = "";
    private byte[] _privateKeyBytes = Array.Empty<byte>();
    private byte[] _publicKeyBytes = Array.Empty<byte>();
    
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
                    identity._publicKeyBytes = Base64UrlDecode(data.PublicKey);
                    identity.PublicKeyBase64Url = data.PublicKey;
                    identity.Id = data.Id ?? ComputeFingerprint(identity._publicKeyBytes);
                    return identity;
                }
            }
            catch
            {
                // Regenerate on error
            }
        }
        
        // Generate new Ed25519 keypair using BouncyCastle
        var keyGen = new Ed25519KeyPairGenerator();
        keyGen.Init(new Ed25519KeyGenerationParameters(new SecureRandom()));
        var keyPair = keyGen.GenerateKeyPair();
        
        var privateKeyParams = (Ed25519PrivateKeyParameters)keyPair.Private;
        var publicKeyParams = (Ed25519PublicKeyParameters)keyPair.Public;
        
        identity._privateKeyBytes = privateKeyParams.GetEncoded();
        identity._publicKeyBytes = publicKeyParams.GetEncoded();
        identity.PublicKeyBase64Url = Base64UrlEncode(identity._publicKeyBytes);
        identity.Id = ComputeFingerprint(identity._publicKeyBytes);
        
        // Save to file
        Directory.CreateDirectory(configDir);
        var keyData = new DeviceKeyData
        {
            Id = identity.Id,
            PublicKey = identity.PublicKeyBase64Url,
            PrivateKey = Base64UrlEncode(identity._privateKeyBytes)
        };
        File.WriteAllText(keyPath, JsonSerializer.Serialize(keyData, new JsonSerializerOptions { WriteIndented = true }));
        
        return identity;
    }
    
    /// <summary>
    /// Create device object for connect request with signed challenge.
    /// Gateway expects payload format: v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce
    /// </summary>
    public object CreateDeviceObject(string? nonce, string clientId, string clientMode, string role, string[] scopes, string? token)
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
        
        // Build payload to sign in Gateway format:
        // v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce
        var scopesStr = string.Join(",", scopes);
        var tokenStr = token ?? "";
        var payload = $"v2|{Id}|{clientId}|{clientMode}|{role}|{scopesStr}|{signedAt}|{tokenStr}|{nonce}";
        var payloadBytes = Encoding.UTF8.GetBytes(payload);
        
        // Sign with Ed25519 using BouncyCastle
        var privateKeyParams = new Ed25519PrivateKeyParameters(_privateKeyBytes, 0);
        var signer = new Ed25519Signer();
        signer.Init(true, privateKeyParams);
        signer.BlockUpdate(payloadBytes, 0, payloadBytes.Length);
        var signatureBytes = signer.GenerateSignature();
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
