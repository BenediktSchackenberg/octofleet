using System.Diagnostics;
using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace OpenClawAgent.Service;

/// <summary>
/// Polls for terminal commands and executes them.
/// </summary>
public class TerminalPoller : BackgroundService
{
    private readonly ILogger<TerminalPoller> _logger;
    private readonly ServiceConfig _config;
    private readonly string _nodeId;
    private readonly HttpClient _httpClient;

    public TerminalPoller(
        ILogger<TerminalPoller> logger,
        ServiceConfig config)
    {
        _logger = logger;
        _config = config;
        _nodeId = Environment.MachineName;
        _httpClient = new HttpClient();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("TerminalPoller started for node {NodeId}", _nodeId);
        
        // Wait for config to be ready
        await Task.Delay(5000, stoppingToken);
        
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!string.IsNullOrEmpty(_config.InventoryApiUrl))
                {
                    await PollAndExecuteCommands(stoppingToken);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in terminal polling");
            }
            
            await Task.Delay(500, stoppingToken); // Poll every 500ms for responsiveness
        }
    }

    private async Task PollAndExecuteCommands(CancellationToken ct)
    {
        var baseUrl = _config.InventoryApiUrl.TrimEnd('/');
        var apiKey = _config.InventoryApiKey ?? "";

        var request = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/api/v1/terminal/pending/{_nodeId}");
        request.Headers.Add("X-API-Key", apiKey);

        var response = await _httpClient.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode) return;

        var json = await response.Content.ReadAsStringAsync(ct);
        var result = JsonSerializer.Deserialize<TerminalPendingResponse>(json, new JsonSerializerOptions 
        { 
            PropertyNameCaseInsensitive = true 
        });

        if (result?.Commands == null || result.Commands.Count == 0) return;

        foreach (var session in result.Commands)
        {
            foreach (var command in session.Commands)
            {
                _logger.LogInformation("Executing terminal command: {Command}", command);
                var output = await ExecuteCommand(session.Shell, command, ct);
                await SendOutput(session.SessionId, output, ct);
            }
        }
    }

    private async Task<string> ExecuteCommand(string shell, string command, CancellationToken ct)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            switch (shell.ToLower())
            {
                case "powershell":
                    psi.FileName = "powershell.exe";
                    psi.Arguments = $"-NoProfile -NonInteractive -Command \"{command.Replace("\"", "\\\"")}\"";
                    break;
                case "cmd":
                    psi.FileName = "cmd.exe";
                    psi.Arguments = $"/c {command}";
                    break;
                case "bash":
                    psi.FileName = "/bin/bash";
                    psi.Arguments = $"-c \"{command.Replace("\"", "\\\"")}\"";
                    break;
                default:
                    return $"Unknown shell: {shell}";
            }

            using var process = Process.Start(psi);
            if (process == null) return "Failed to start process";

            var stdout = await process.StandardOutput.ReadToEndAsync(ct);
            var stderr = await process.StandardError.ReadToEndAsync(ct);
            
            await process.WaitForExitAsync(ct);

            var output = new StringBuilder();
            if (!string.IsNullOrEmpty(stdout)) output.Append(stdout);
            if (!string.IsNullOrEmpty(stderr)) output.Append(stderr);
            
            return output.ToString();
        }
        catch (Exception ex)
        {
            return $"Error: {ex.Message}";
        }
    }

    private async Task SendOutput(string sessionId, string output, CancellationToken ct)
    {
        var baseUrl = _config.InventoryApiUrl.TrimEnd('/');
        var apiKey = _config.InventoryApiKey ?? "";

        var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/api/v1/terminal/output/{sessionId}");
        request.Headers.Add("X-API-Key", apiKey);
        request.Content = new StringContent(
            JsonSerializer.Serialize(new { output }),
            Encoding.UTF8,
            "application/json"
        );

        await _httpClient.SendAsync(request, ct);
    }

    private class TerminalPendingResponse
    {
        public List<TerminalSession> Commands { get; set; } = new();
    }

    private class TerminalSession
    {
        public string SessionId { get; set; } = "";
        public string Shell { get; set; } = "powershell";
        public List<string> Commands { get; set; } = new();
    }
}
