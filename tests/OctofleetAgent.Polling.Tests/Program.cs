using OctofleetAgent.Service;

// Terminal polling (#283): the idle request rate, and how long a new session waits for the agent.
// A simulated clock runs the agent's poll loop against a simulated server; nothing waits for real.

var fast = TimeSpan.FromMilliseconds(500);  // the Windows terminal poller while a session is open
var start = new DateTime(2026, 11, 16, 12, 0, 0, DateTimeKind.Utc);

// Runs the poll loop for `duration`. serverActive(t): the server reports an open terminal page at t
// seconds; commands(t0, t1): commands queued between two polls. Returns the poll times in seconds.
List<double> Simulate(TimeSpan duration, Func<double, bool> serverActive, Func<double, double, bool>? commands = null, int seed = 1)
{
    var now = start;
    var pace = new PollPace(fast, now: () => now, random: new Random(seed));
    var polls = new List<double>();
    var last = double.NegativeInfinity;
    while (now - start < duration)
    {
        var t = (now - start).TotalSeconds;
        polls.Add(t);
        var active = serverActive(t) || (commands?.Invoke(last, t) ?? false);
        last = t;
        now += pace.Next(active);
    }
    return polls;
}

// 1. Idle request rate: no terminal page open for 10 minutes
var idle = Simulate(TimeSpan.FromMinutes(10), _ => false);
Console.WriteLine($"idle: {idle.Count} terminal polls in 10 minutes (before: 1200 at a fixed 0.5 s)");
Assert(idle.Count is >= 109 and <= 134, "idle: about one poll per 5 s (109-134 in 10 minutes)");
var gaps = idle.Zip(idle.Skip(1), (a, b) => b - a).ToList();
Assert(gaps.All(g => g is >= 4.5 and <= 5.5), "idle: every gap 4.5-5.5 s");

// 2. Session start delay: a terminal page opens at a random moment; how long until the agent polls fast
var delays = new List<double>();
var everyHalfSecond = true;
var random = new Random(7);
for (var i = 0; i < 1000; i++)
{
    var opened = 60 + random.NextDouble() * 60;
    var polls = Simulate(TimeSpan.FromMinutes(3), t => t >= opened, seed: i);
    var first = polls.First(t => t >= opened);
    delays.Add(first - opened);
    // from then on every 0.5 s
    var after = polls.Where(t => t >= first && t < first + 60).ToList();
    everyHalfSecond &= after.Zip(after.Skip(1), (a, b) => b - a).All(g => Math.Abs(g - 0.5) < 1e-6);
}
Console.WriteLine($"session start delay: average {delays.Average():F1} s, longest {delays.Max():F1} s (before: at most 0.5 s)");
Assert(delays.Max() <= 5.5, "session start: the agent notices an open page within 5.5 s");
Assert(delays.Average() is >= 2 and <= 3.5, "session start: about 2.5 s on average");
Assert(everyHalfSecond, "while the page is open: every 0.5 s (1,000 sessions)");

// 3. Commands while the page is open wait at most 0.5 s
{
    var commandsAt = new[] { 70.0, 71.2, 95.3, 140.9 };
    var polls = Simulate(TimeSpan.FromMinutes(3), t => t >= 62 && t < 150,
        (t0, t1) => commandsAt.Any(c => c > t0 && c <= t1));
    var waits = commandsAt.Select(c => polls.First(t => t >= c) - c).ToList();
    Assert(waits.All(w => w <= 0.5 + 1e-6), "commands in an open session wait at most 0.5 s");
}

// 4. After the page closes: fast for the grace time (60 s), then idle again
{
    var polls = Simulate(TimeSpan.FromMinutes(10), t => t >= 10 && t < 70);
    var closedPhase = polls.Where(t => t >= 70).ToList();
    var fastAfterClose = closedPhase.Count(t => t < 130);
    Assert(fastAfterClose is >= 110 and <= 121, "after closing: still every 0.5 s for 60 s (a reopened page waits for nothing)");
    var late = closedPhase.Where(t => t >= 135).ToList();
    Assert(late.Zip(late.Skip(1), (a, b) => b - a).All(g => g is >= 4.5 and <= 5.5), "after the grace time: idle again");
}

// 5. A server before #283 sends no "active": the first command waits up to 5.5 s, the next ones 0.5 s
{
    var commandsAt = new[] { 100.3, 110.0, 130.7 };
    var polls = Simulate(TimeSpan.FromMinutes(3), _ => false, (t0, t1) => commandsAt.Any(c => c > t0 && c <= t1));
    var waits = commandsAt.Select(c => polls.First(t => t >= c) - c).ToList();
    Assert(waits[0] <= 5.5, "older server: first command within 5.5 s");
    Assert(waits.Skip(1).All(w => w <= 0.5 + 1e-6), "older server: following commands within 0.5 s");
}

// 6. 1,000 agents started together do not poll in the same moment
{
    var tenths = new HashSet<long>();
    for (var i = 0; i < 1000; i++)
        tenths.Add((long)(Simulate(TimeSpan.FromSeconds(60), _ => false, seed: i)[5] * 10));
    Assert(tenths.Count > 30, $"1,000 agents: their 6th poll is spread ({tenths.Count} different tenths of a second)");
}

Console.WriteLine(failures == 0 ? "All poll pace tests passed" : $"{failures} poll pace test(s) failed");
return failures == 0 ? 0 : 1;

void Assert(bool condition, string description)
{
    Console.WriteLine($"{(condition ? "PASS" : "FAIL")}  {description}");
    if (!condition) failures++;
}

partial class Program { static int failures; }
