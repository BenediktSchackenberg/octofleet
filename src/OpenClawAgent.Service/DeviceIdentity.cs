using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace OpenClawAgent.Service;

/// <summary>
/// Manages device identity for Gateway authentication.
/// Uses Ed25519 keypair for signing challenges.
/// </summary>
public class DeviceIdentity
{
    private const string KeyFileName = "device-identity.json";
    
    public string Id { get; private set; } = "";
    public string PublicKey { get; private set; } = "";
    private byte[] _privateKey = Array.Empty<byte>();
    
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
                    identity._privateKey = Convert.FromBase64String(data.PrivateKey);
                    identity.PublicKey = data.PublicKey;
                    identity.Id = data.Id ?? ComputeFingerprint(Convert.FromBase64String(data.PublicKey));
                    return identity;
                }
            }
            catch
            {
                // Regenerate on error
            }
        }
        
        // Generate new keypair using Ed25519
        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var privateKeyBytes = ecdsa.ExportECPrivateKey();
        var publicKeyBytes = ecdsa.ExportSubjectPublicKeyInfo();
        
        identity._privateKey = privateKeyBytes;
        identity.PublicKey = Convert.ToBase64String(publicKeyBytes);
        identity.Id = ComputeFingerprint(publicKeyBytes);
        
        // Save to file
        Directory.CreateDirectory(configDir);
        var keyData = new DeviceKeyData
        {
            Id = identity.Id,
            PublicKey = identity.PublicKey,
            PrivateKey = Convert.ToBase64String(privateKeyBytes)
        };
        File.WriteAllText(keyPath, JsonSerializer.Serialize(keyData, new JsonSerializerOptions { WriteIndented = true }));
        
        return identity;
    }
    
    /// <summary>
    /// Sign a challenge nonce for authentication.
    /// </summary>
    public (string signature, long signedAt, string nonce) SignChallenge(string challenge)
    {
        var signedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        
        // Create message to sign: challenge + signedAt
        var message = $"{challenge}:{signedAt}";
        var messageBytes = Encoding.UTF8.GetBytes(message);
        
        using var ecdsa = ECDsa.Create();
        ecdsa.ImportECPrivateKey(_privateKey, out _);
        
        var signatureBytes = ecdsa.SignData(messageBytes, HashAlgorithmName.SHA256);
        var signature = Convert.ToBase64String(signatureBytes);
        
        return (signature, signedAt, challenge);
    }
    
    /// <summary>
    /// Create device object for connect request.
    /// </summary>
    public object CreateDeviceObject(string? challenge = null)
    {
        if (string.IsNullOrEmpty(challenge))
        {
            // Local connection without challenge
            return new
            {
                id = Id,
                publicKey = PublicKey
            };
        }
        
        var (signature, signedAt, nonce) = SignChallenge(challenge);
        return new
        {
            id = Id,
            publicKey = PublicKey,
            signature,
            signedAt,
            nonce
        };
    }
    
    private static string ComputeFingerprint(byte[] publicKeyBytes)
    {
        var hash = SHA256.HashData(publicKeyBytes);
        return Convert.ToHexString(hash).ToLowerInvariant().Substring(0, 40);
    }
    
    private class DeviceKeyData
    {
        public string? Id { get; set; }
        public string? PublicKey { get; set; }
        public string? PrivateKey { get; set; }
    }
}
