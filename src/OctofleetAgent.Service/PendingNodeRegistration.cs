using System.Management;
using System.Net.Http.Json;
using System.Text.Json;

namespace OctofleetAgent.Service;

/// <summary>
/// Handles automatic registration with the backend and polling for approval
/// </summary>
public class PendingNodeRegistration : BackgroundService
{
    private readonly ILogger<PendingNodeRegistration> _logger;
    private readonly ServiceConfig _config;
    private readonly HttpClient _httpClient;
    private const int PollIntervalMs = 10000; // Poll every 10 seconds

    public PendingNodeRegistration(ILogger<PendingNodeRegistration> logger, ServiceConfig config)
    {
        _logger = logger;
        _config = config;
        _httpClient = AgentHttp.Create(TimeSpan.FromSeconds(30));
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Wait a bit for other services to start
        await Task.Delay(2000, stoppingToken);
        
        var config = ServiceConfig.Load();
        
        // If already configured, nothing to do
        if (config.IsInventoryConfigured)
        {
            _logger.LogDebug("Node already configured, skipping registration flow");
            return;
        }

        _logger.LogInformation("Node not configured. Starting auto-registration flow...");

        // Determine backend URL
        var backendUrl = config.DiscoveryUrl ?? "http://192.168.0.5:8080";

        while (!stoppingToken.IsCancellationRequested)
        {
            config = ServiceConfig.Load();
            var pendingId = config.PendingId;
            var secret = RevealSecret(config.PendingSecret);

            // A pending ID without secret comes from an older agent version: the server no longer
            // hands out its configuration, so register again.
            if (!PendingRegistrationProtocol.CanPoll(pendingId, secret))
            {
                var registration = await RegisterAsPendingAsync(backendUrl, stoppingToken);
                if (registration == null)
                {
                    _logger.LogError("Failed to register as pending node. Manual configuration required.");
                    return;
                }
                if (!PendingRegistrationProtocol.CanPoll(registration.PendingId, registration.RegistrationSecret))
                {
                    // The secret goes only to the first registration of a machine
                    _logger.LogWarning("This machine is already registered and waiting for approval (ID: {PendingId}), " +
                        "but not by this installation. Reject that entry in the web UI; registering again in 5 minutes.",
                        registration.PendingId);
                    ConsoleUI.SetStatus("Pending", "Already registered by another installation");
                    await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken);
                    continue;
                }

                // Save pending ID and secret so we can resume after restart
                pendingId = registration.PendingId!;
                secret = registration.RegistrationSecret!;
                config.PendingId = pendingId;
                config.PendingSecret = ProtectSecret(secret);
                config.Save();
                _logger.LogInformation("Registered as pending node (ID: {PendingId}). Waiting for admin approval...", pendingId);
            }
            else
            {
                _logger.LogInformation("Already registered as pending (ID: {PendingId}), polling for approval...", pendingId);
            }
            ConsoleUI.SetStatus("Pending", "Awaiting admin approval in web UI");

            if (!await PollForApprovalAsync(backendUrl, pendingId!, secret!, stoppingToken))
                return;

            // The registration is lost (unknown ID, secret used or invalid): register again
            _logger.LogWarning("Registration {PendingId} is no longer valid, registering again", pendingId);
            config = ServiceConfig.Load();
            config.PendingId = null;
            config.PendingSecret = null;
            config.Save();
            await Task.Delay(PollIntervalMs, stoppingToken);
        }
    }

    private static string? RevealSecret(string? stored) =>
        stored != null && stored.StartsWith(AgentKeyProtection.Prefix, StringComparison.Ordinal)
            ? AgentKeyProtection.Unprotect(stored)
            : stored;

    private static string ProtectSecret(string secret) =>
        AgentKeyProtection.CanProtect ? AgentKeyProtection.Protect(secret) : secret;

    private async Task<RegistrationResponse?> RegisterAsPendingAsync(string backendUrl, CancellationToken ct)
    {
        try
        {
            var payload = new
            {
                hostname = Environment.MachineName,
                osName = GetOsName(),
                osVersion = Environment.OSVersion.Version.ToString(),
                agentVersion = GetAgentVersion(),
                machineId = GetMachineId()
            };

            _logger.LogDebug("Registering at {Url}/api/v1/nodes/register", backendUrl);
            
            var response = await _httpClient.PostAsJsonAsync(
                $"{backendUrl}/api/v1/nodes/register", 
                payload, 
                ct);

            if (response.IsSuccessStatusCode)
            {
                return await response.Content.ReadFromJsonAsync<RegistrationResponse>(cancellationToken: ct);
            }
            else
            {
                var error = await response.Content.ReadAsStringAsync(ct);
                _logger.LogError("Registration failed: {StatusCode} - {Error}", response.StatusCode, error);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to register as pending node");
        }

        return null;
    }

    /// <summary>Polls until approved or rejected (false: done) or the registration is lost (true:
    /// register again).</summary>
    private async Task<bool> PollForApprovalAsync(string backendUrl, string pendingId, string secret, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var request = PendingRegistrationProtocol.ConfigRequest(backendUrl, pendingId, secret);
                using var response = await _httpClient.SendAsync(request, ct);
                ConfigResponse? result = null;
                if (response.IsSuccessStatusCode)
                    result = await response.Content.ReadFromJsonAsync<ConfigResponse>(cancellationToken: ct);

                switch (PendingRegistrationProtocol.Classify(response.StatusCode, result?.Status, result?.Config != null))
                {
                    case PendingRegistrationProtocol.PollOutcome.Approved:
                        _logger.LogInformation("Node approved! Applying configuration...");
                        await ApplyConfigurationAsync(result!.Config!);
                        return false;
                    case PendingRegistrationProtocol.PollOutcome.Rejected:
                        _logger.LogWarning("Node was rejected by admin. Manual configuration required.");
                        ConsoleUI.SetStatus("Rejected", "Node was rejected by admin");

                        // Clear pending ID
                        var config = ServiceConfig.Load();
                        config.PendingId = null;
                        config.PendingSecret = null;
                        config.Save();
                        return false;
                    case PendingRegistrationProtocol.PollOutcome.RegisterAgain:
                        return true;
                    // Pending or Retry: continue polling
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                _logger.LogDebug("Error polling for approval: {Message}", ex.Message);
            }

            await Task.Delay(PollIntervalMs, ct);
        }
        return false;
    }

    private async Task ApplyConfigurationAsync(ConfigData config)
    {
        try
        {
            var serviceConfig = ServiceConfig.Load();
            
            // Apply the received configuration
            serviceConfig.InventoryApiUrl = config.InventoryApiUrl ?? serviceConfig.InventoryApiUrl;
            serviceConfig.InventoryApiKey = config.InventoryApiKey ?? serviceConfig.InventoryApiKey;
            serviceConfig.DisplayName = config.DisplayName ?? Environment.MachineName;
            serviceConfig.AutoPushInventory = config.AutoPushInventory;
            serviceConfig.ScheduledPushEnabled = config.ScheduledPushEnabled;
            serviceConfig.ScheduledPushIntervalMinutes = config.ScheduledPushIntervalMinutes;
            
            // Clear pending ID since we're now approved
            serviceConfig.PendingId = null;
            serviceConfig.PendingSecret = null;
            
            serviceConfig.Save();
            
            _logger.LogInformation("Configuration applied successfully! Restarting service...");
            ConsoleUI.SetStatus("Approved", "Configuration applied, restarting...");
            
            // Give time for the message to be seen
            await Task.Delay(2000);
            
            // Request service restart - the service manager will restart us
            Environment.Exit(0);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to apply configuration");
        }
    }

    private static string GetOsName()
    {
        try
        {
            using var searcher = Wmi.Searcher("SELECT Caption FROM Win32_OperatingSystem");
            foreach (var obj in searcher.Get())
            {
                return obj["Caption"]?.ToString() ?? "Windows";
            }
        }
        catch { }
        return "Windows";
    }

    private static string GetMachineId()
    {
        try
        {
            // Use motherboard serial number as unique ID
            using var searcher = Wmi.Searcher("SELECT SerialNumber FROM Win32_BaseBoard");
            foreach (var obj in searcher.Get())
            {
                var serial = obj["SerialNumber"]?.ToString();
                if (!string.IsNullOrEmpty(serial) && serial != "To be filled by O.E.M.")
                {
                    return serial;
                }
            }
            
            // Fallback to BIOS serial
            using var biosSearcher = Wmi.Searcher("SELECT SerialNumber FROM Win32_BIOS");
            foreach (var obj in biosSearcher.Get())
            {
                var serial = obj["SerialNumber"]?.ToString();
                if (!string.IsNullOrEmpty(serial) && serial != "To be filled by O.E.M.")
                {
                    return serial;
                }
            }
        }
        catch { }
        
        // Last resort: machine name (not unique but better than nothing)
        return Environment.MachineName;
    }

    private static string GetAgentVersion()
    {
        try
        {
            var assembly = typeof(PendingNodeRegistration).Assembly;
            var version = assembly.GetName().Version;
            return version?.ToString(3) ?? "0.0.0";
        }
        catch
        {
            return "0.0.0";
        }
    }

    private class RegistrationResponse
    {
        public string? Status { get; set; }
        public string? PendingId { get; set; }
        public string? RegistrationSecret { get; set; }
        public string? Message { get; set; }
    }

    private class ConfigResponse
    {
        public string? Status { get; set; }
        public string? Message { get; set; }
        public ConfigData? Config { get; set; }
    }

    private class ConfigData
    {
        public string? InventoryApiUrl { get; set; }
        public string? InventoryApiKey { get; set; }
        public string? DisplayName { get; set; }
        public bool AutoPushInventory { get; set; } = true;
        public bool ScheduledPushEnabled { get; set; } = true;
        public int ScheduledPushIntervalMinutes { get; set; } = PushSchedule.DefaultIntervalMinutes;
    }
}
