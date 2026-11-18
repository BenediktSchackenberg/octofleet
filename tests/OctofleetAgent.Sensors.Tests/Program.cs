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

Console.WriteLine(failures == 0 ? "all sensor setting checks passed" : $"{failures} check(s) failed");
return failures == 0 ? 0 : 1;
