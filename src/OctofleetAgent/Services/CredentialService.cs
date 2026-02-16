using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using OctofleetAgent.Models;

namespace OctofleetAgent.Services;

/// <summary>
/// Service for securely storing credentials using Windows Credential Manager / DPAPI
/// </summary>
public static class CredentialService
{
    private static readonly string AppDataPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Octofleet", "Agent");

    private static readonly string GatewaysFile = Path.Combine(AppDataPath, "gateways.json");

    static CredentialService()
    {
        Directory.CreateDirectory(AppDataPath);
    }

    /// <summary>
    /// Get all stored gateway configurations
    /// </summary>
    public static List<GatewayConfig> GetStoredGateways()
    {
        try
        {
            if (!File.Exists(GatewaysFile))
            {
                return new List<GatewayConfig>();
            }

            var encryptedData = File.ReadAllBytes(GatewaysFile);
            var jsonData = UnprotectData(encryptedData);
            var json = Encoding.UTF8.GetString(jsonData);

            return JsonSerializer.Deserialize<List<GatewayConfig>>(json) ?? new List<GatewayConfig>();
        }
        catch
        {
            return new List<GatewayConfig>();
        }
    }

    /// <summary>
    /// Save a gateway configuration securely
    /// </summary>
    public static void SaveGateway(GatewayConfig gateway)
    {
        var gateways = GetStoredGateways();
        var existing = gateways.FindIndex(g => g.Id == gateway.Id);

        if (existing >= 0)
        {
            gateways[existing] = gateway;
        }
        else
        {
            gateways.Add(gateway);
        }

        SaveGateways(gateways);
    }

    /// <summary>
    /// Remove a gateway configuration
    /// </summary>
    public static void RemoveGateway(GatewayConfig gateway)
    {
        var gateways = GetStoredGateways();
        gateways.RemoveAll(g => g.Id == gateway.Id);
        SaveGateways(gateways);
    }

    /// <summary>
    /// Get the default gateway
    /// </summary>
    public static GatewayConfig? GetDefaultGateway()
    {
        var gateways = GetStoredGateways();
        return gateways.FirstOrDefault(g => g.IsDefault) ?? gateways.FirstOrDefault();
    }

    private static void SaveGateways(List<GatewayConfig> gateways)
    {
        var json = JsonSerializer.Serialize(gateways, new JsonSerializerOptions { WriteIndented = true });
        var jsonData = Encoding.UTF8.GetBytes(json);
        var encryptedData = ProtectData(jsonData);
        File.WriteAllBytes(GatewaysFile, encryptedData);
    }

    /// <summary>
    /// Encrypt data using Windows DPAPI (user scope)
    /// </summary>
    private static byte[] ProtectData(byte[] data)
    {
        return ProtectedData.Protect(data, null, DataProtectionScope.CurrentUser);
    }

    /// <summary>
    /// Decrypt data using Windows DPAPI
    /// </summary>
    private static byte[] UnprotectData(byte[] encryptedData)
    {
        return ProtectedData.Unprotect(encryptedData, null, DataProtectionScope.CurrentUser);
    }

    #region Windows Credential Manager (alternative for more sensitive data)

    /// <summary>
    /// Store a secret in Windows Credential Manager
    /// </summary>
    public static void StoreSecret(string key, string secret)
    {
        // Use Windows Credential Manager for highly sensitive data
        // This is a simplified implementation - production would use proper P/Invoke
        var credentialFile = Path.Combine(AppDataPath, $"secret_{key}.bin");
        var encryptedData = ProtectData(Encoding.UTF8.GetBytes(secret));
        File.WriteAllBytes(credentialFile, encryptedData);
    }

    /// <summary>
    /// Retrieve a secret from Windows Credential Manager
    /// </summary>
    public static string? GetSecret(string key)
    {
        var credentialFile = Path.Combine(AppDataPath, $"secret_{key}.bin");
        if (!File.Exists(credentialFile))
        {
            return null;
        }

        try
        {
            var encryptedData = File.ReadAllBytes(credentialFile);
            var data = UnprotectData(encryptedData);
            return Encoding.UTF8.GetString(data);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Delete a secret from storage
    /// </summary>
    public static void DeleteSecret(string key)
    {
        var credentialFile = Path.Combine(AppDataPath, $"secret_{key}.bin");
        if (File.Exists(credentialFile))
        {
            File.Delete(credentialFile);
        }
    }

    #endregion
}
