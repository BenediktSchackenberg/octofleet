using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using System.Collections.ObjectModel;

namespace OctofleetAgent.ViewModels;

/// <summary>
/// Commands view model - Octofleet command terminal
/// </summary>
public partial class CommandsViewModel : ObservableObject
{
    [ObservableProperty]
    private string _title = "Command Terminal";

    [ObservableProperty]
    private string _commandInput = "";

    [ObservableProperty]
    private ObservableCollection<CommandOutput> _commandHistory = new();

    [ObservableProperty]
    private int _historyIndex = -1;

    private readonly List<string> _inputHistory = new();
    private int _inputHistoryIndex = -1;

    public CommandsViewModel()
    {
        // Add welcome message
        CommandHistory.Add(new CommandOutput
        {
            Timestamp = DateTime.Now,
            Text = "Octofleet Command Terminal\nType 'help' for available commands.\n",
            IsSystem = true
        });
    }

    [RelayCommand]
    private async Task ExecuteCommandAsync()
    {
        if (string.IsNullOrWhiteSpace(CommandInput)) return;

        var command = CommandInput.Trim();
        _inputHistory.Add(command);
        _inputHistoryIndex = _inputHistory.Count;

        // Add command to output
        CommandHistory.Add(new CommandOutput
        {
            Timestamp = DateTime.Now,
            Text = $"> {command}",
            IsCommand = true
        });

        // Clear input
        CommandInput = "";

        // Execute command
        try
        {
            var result = await ExecuteOctofleetCommandAsync(command);
            CommandHistory.Add(new CommandOutput
            {
                Timestamp = DateTime.Now,
                Text = result.Output,
                IsError = !result.Success
            });
        }
        catch (Exception ex)
        {
            CommandHistory.Add(new CommandOutput
            {
                Timestamp = DateTime.Now,
                Text = $"Error: {ex.Message}",
                IsError = true
            });
        }
    }

    [RelayCommand]
    private void HistoryUp()
    {
        if (_inputHistory.Count == 0) return;
        
        if (_inputHistoryIndex > 0)
        {
            _inputHistoryIndex--;
            CommandInput = _inputHistory[_inputHistoryIndex];
        }
    }

    [RelayCommand]
    private void HistoryDown()
    {
        if (_inputHistory.Count == 0) return;

        if (_inputHistoryIndex < _inputHistory.Count - 1)
        {
            _inputHistoryIndex++;
            CommandInput = _inputHistory[_inputHistoryIndex];
        }
        else
        {
            _inputHistoryIndex = _inputHistory.Count;
            CommandInput = "";
        }
    }

    [RelayCommand]
    private void ClearHistory()
    {
        CommandHistory.Clear();
    }

    [RelayCommand]
    private void CopyOutput()
    {
        var text = string.Join("\n", CommandHistory.Select(c => c.Text));
        System.Windows.Clipboard.SetText(text);
    }

    private async Task<CommandResult> ExecuteOctofleetCommandAsync(string command)
    {
        // Handle built-in commands
        if (command.Equals("help", StringComparison.OrdinalIgnoreCase))
        {
            return new CommandResult
            {
                Success = true,
                Output = @"Available commands:
  status       - Show agent and gateway status
  config       - Show current configuration
  gateways     - List configured gateways
  connect      - Connect to default gateway
  disconnect   - Disconnect from gateway
  logs         - Show recent logs
  clear        - Clear terminal
  help         - Show this help

Octofleet CLI commands are also supported (e.g., 'octofleet status')"
            };
        }

        if (command.Equals("clear", StringComparison.OrdinalIgnoreCase))
        {
            CommandHistory.Clear();
            return new CommandResult { Success = true, Output = "" };
        }

        if (command.Equals("status", StringComparison.OrdinalIgnoreCase))
        {
            return new CommandResult
            {
                Success = true,
                Output = $@"Agent Status:
  Client ID:    {Environment.MachineName}
  Connected:    No
  Gateway:      -
  Last Sync:    Never"
            };
        }

        // Execute via Octofleet CLI
        return await ExecuteCliCommandAsync(command);
    }

    private async Task<CommandResult> ExecuteCliCommandAsync(string command)
    {
        try
        {
            var processInfo = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "octofleet",
                Arguments = command.StartsWith("octofleet ") ? command.Substring(9) : command,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = System.Diagnostics.Process.Start(processInfo);
            if (process == null)
            {
                return new CommandResult
                {
                    Success = false,
                    Output = "Failed to start process"
                };
            }

            var output = await process.StandardOutput.ReadToEndAsync();
            var error = await process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();

            return new CommandResult
            {
                Success = process.ExitCode == 0,
                Output = string.IsNullOrEmpty(error) ? output : $"{output}\n{error}"
            };
        }
        catch (Exception ex)
        {
            return new CommandResult
            {
                Success = false,
                Output = $"Failed to execute command: {ex.Message}"
            };
        }
    }
}

public class CommandOutput
{
    public DateTime Timestamp { get; set; }
    public string Text { get; set; } = "";
    public bool IsCommand { get; set; }
    public bool IsError { get; set; }
    public bool IsSystem { get; set; }
}

public class CommandResult
{
    public bool Success { get; set; }
    public string Output { get; set; } = "";
}
