global using Microsoft.Extensions.Hosting;
global using Microsoft.Extensions.Logging;
using System.Reflection;
using Microsoft.Extensions.Logging.Abstractions;
using OctofleetAgent.Service;
using OctofleetAgent.Service.Security;

// Sensor settings from the server's effective-policy answer: profile first, then the fleet-wide
// defaults, else null (= on, for servers that send neither).

var failures = 0;
void Check(bool? actual, bool? expected, string name)
{
    var ok = actual == expected;
    if (!ok) failures++;
    Console.WriteLine($"{(ok ? "ok  " : "FAIL")} {name}: {actual?.ToString() ?? "null"}");
}

const string NoPolicyDefaultOff = """{"policy": null, "defaults": {"network_connections": false}, "message": "No monitoring policy assigned"}""";
const string ProfileOn = """{"policy": {"profile_name": "net", "sensors": {"network_connections": true, "network_monitor": true}}, "defaults": {"network_connections": false}}""";
const string ProfileWithoutKey = """{"policy": {"profile_name": "base", "sensors": {"network_monitor": true}}, "defaults": {"network_connections": false}}""";
const string ProfileMonitorOff = """{"policy": {"sensors": {"network_monitor": false}}, "defaults": {"network_connections": false}}""";
const string OldServerNoPolicy = """{"policy": null, "message": "No monitoring policy assigned"}""";
const string OldServerProfile = """{"policy": {"sensors": {"network_monitor": true}}}""";
const string SensorsAsText = """{"policy": {"sensors": "{\"network_connections\": true}"}, "defaults": {"network_connections": false}}""";

Check(SensorSettings.Resolve(NoPolicyDefaultOff, "network_connections"), false, "no profile: fleet default off");
Check(SensorSettings.Resolve(NoPolicyDefaultOff, "network_monitor"), null, "no profile: network monitor (listen) not set = on");
Check(SensorSettings.Resolve(ProfileOn, "network_connections"), true, "profile turns connections on");
Check(SensorSettings.Resolve(ProfileWithoutKey, "network_connections"), false, "profile without the key: fleet default");
Check(SensorSettings.Resolve(ProfileMonitorOff, "network_monitor"), false, "profile turns the network monitor off");
Check(SensorSettings.Resolve(OldServerNoPolicy, "network_connections"), null, "older server: not set = on");
Check(SensorSettings.Resolve(OldServerProfile, "network_connections"), null, "older server with profile: not set = on");
Check(SensorSettings.Resolve(SensorsAsText, "network_connections"), true, "sensors sent as JSON text");
Check(SensorSettings.Resolve("not json", "network_connections"), null, "invalid answer");

// Exercise successive HTTP 200 responses against the real collector, without starting it.
var collector = new NetworkMonitorCollector(NullLogger<NetworkMonitorCollector>.Instance);
var flags = BindingFlags.NonPublic | BindingFlags.Instance;
var refresh = typeof(NetworkMonitorCollector).GetMethod("RefreshSettingsAsync", flags)!;
var monitor = typeof(NetworkMonitorCollector).GetField("_monitorEnabled", flags)!;
var connections = typeof(NetworkMonitorCollector).GetField("_connectionsEnabled", flags)!;
AgentHttp.Body = """{"policy":{"sensors":{"network_monitor":false,"network_connections":false}}}""";
Check(await (Task<bool>)refresh.Invoke(collector, [new ServiceConfig()])!, true, "disabled policy accepted");
foreach (var invalid in new[] { "<html>proxy error</html>", "null", "[]", "{}", """{"policy":42}""" })
{
    AgentHttp.Body = invalid;
    Check(await (Task<bool>)refresh.Invoke(collector, [new ServiceConfig()])!, false, "invalid policy rejected");
    Check((bool)monitor.GetValue(collector)!, false, "monitor stays disabled");
    Check((bool)connections.GetValue(collector)!, false, "connections stay disabled");
}
AgentHttp.Body = OldServerNoPolicy;
Check(await (Task<bool>)refresh.Invoke(collector, [new ServiceConfig()])!, true, "old server accepted");
Check((bool)monitor.GetValue(collector)!, true, "old server monitor fallback");
Check((bool)connections.GetValue(collector)!, true, "old server connections fallback");

Console.WriteLine(failures == 0 ? "all sensor setting checks passed" : $"{failures} check(s) failed");
return failures == 0 ? 0 : 1;
