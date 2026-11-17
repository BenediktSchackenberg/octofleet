using OctofleetAgent.Service;

// Self-contained checks for the spread of the scheduled inventory push (#283).
var failures = 0;
void Assert(bool condition, string description)
{
    Console.WriteLine($"{(condition ? "PASS" : "FAIL")}  {description}");
    if (!condition) failures++;
}

var random = new Random(283);
const int Runs = 10_000;

double Min(Func<double> f) { var m = double.MaxValue; for (var i = 0; i < Runs; i++) m = Math.Min(m, f()); return m; }
double Max(Func<double> f) { var m = double.MinValue; for (var i = 0; i < Runs; i++) m = Math.Max(m, f()); return m; }

Assert(PushSchedule.DefaultIntervalMinutes == 60, "the default interval is 60 minutes");

var startupMin = Min(() => PushSchedule.StartupDelay(random).TotalSeconds);
var startupMax = Max(() => PushSchedule.StartupDelay(random).TotalSeconds);
Assert(startupMin >= 30 && startupMax <= 120 && startupMax - startupMin > 80, $"startup push after 30-120 s, spread ({startupMin:F0}-{startupMax:F0} s)");

var firstMin = Min(() => PushSchedule.FirstDelay(60, random).TotalMinutes);
var firstMax = Max(() => PushSchedule.FirstDelay(60, random).TotalMinutes);
Assert(firstMin >= 30 && firstMax <= 90 && firstMax - firstMin > 55, $"first scheduled push spread over a whole interval: 30-90 min ({firstMin:F1}-{firstMax:F1})");

// 1,000 nodes started together: their first scheduled pushes fall into all 60 minutes of the spread
var minutes = new HashSet<int>();
for (var i = 0; i < 1000; i++) minutes.Add((int)PushSchedule.FirstDelay(60, random).TotalMinutes);
Assert(minutes.Count >= 59, $"1,000 nodes started together push in {minutes.Count} different minutes");

var nextMin = Min(() => PushSchedule.NextDelay(60, random).TotalMinutes);
var nextMax = Max(() => PushSchedule.NextDelay(60, random).TotalMinutes);
Assert(nextMin >= 54 && nextMax <= 66 && nextMax - nextMin > 10, $"later pushes after the interval +/- 10 % ({nextMin:F1}-{nextMax:F1} min)");

var retryMin = Min(() => PushSchedule.RetryDelay(60, random).TotalMinutes);
var retryMax = Max(() => PushSchedule.RetryDelay(60, random).TotalMinutes);
Assert(retryMin >= 4.5 && retryMax <= 5.5, $"a failed push is retried after about 5 minutes ({retryMin:F2}-{retryMax:F2})");
Assert(PushSchedule.RetryDelay(2, random).TotalMinutes <= 2.2, "the retry never waits longer than a short configured interval");

Assert(PushSchedule.Interval(30) == 30, "a configured interval (e.g. 30 from older installers) is kept");
Assert(PushSchedule.Interval(0) == 1 && PushSchedule.Interval(-5) == 1, "the interval is at least one minute");

Console.WriteLine(failures == 0 ? "All push schedule checks passed." : $"{failures} check(s) failed.");
return failures == 0 ? 0 : 1;
