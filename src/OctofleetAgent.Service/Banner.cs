namespace OctofleetAgent.Service;

public static class Banner
{
    public static void Show(string version)
    {
        var originalColor = Console.ForegroundColor;
        
        // Purple/Magenta for the octopus
        Console.ForegroundColor = ConsoleColor.Magenta;
        Console.WriteLine(@"
        ████████████        
      ██            ██      
    ██  ██      ██    ██    
    ██  ██      ██    ██    
    ██                ██    
      ██            ██      
    ██  ██  ██  ██  ██  ██  
    █    █  █    █  █    █  
    █    █  █    █  █    █  
");
        
        // Cyan for the box
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine(@"    ╔═════════════════════════╗");
        Console.Write(@"    ║  ");
        
        // White for the name
        Console.ForegroundColor = ConsoleColor.White;
        Console.Write("O C T O F L E E T");
        
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine(@"      ║");
        
        Console.Write(@"    ║  ");
        Console.ForegroundColor = ConsoleColor.DarkGray;
        Console.Write($"v{version,-19}");
        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine(@"  ║");
        
        Console.WriteLine(@"    ╚═════════════════════════╝");
        
        // Reset color
        Console.ForegroundColor = originalColor;
        Console.WriteLine();
    }
}
