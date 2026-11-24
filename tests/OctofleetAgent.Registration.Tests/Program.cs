using System.Net;
using OctofleetAgent.Service;
using static OctofleetAgent.Service.PendingRegistrationProtocol;

// Self-registration of a new agent: the config poll carries the one-time secret, and the agent
// registers again when the server no longer knows the registration or the secret.

// 1. The config request
using (var request = ConfigRequest("https://fleet.example.com/", "42", "s3cret"))
{
    Assert(request.Method == HttpMethod.Get, "config: GET");
    Assert(request.RequestUri!.ToString() == "https://fleet.example.com/api/v1/pending-nodes/42/config",
        $"config: URL without a double slash ({request.RequestUri})");
    Assert(request.Headers.TryGetValues(SecretHeader, out var values) && values.Single() == "s3cret",
        "config: the secret in X-Registration-Secret");
}
using (var request = ConfigRequest("http://srv:8080", "a/b", "x"))
    Assert(request.RequestUri!.AbsolutePath == "/api/v1/pending-nodes/a%2Fb/config", "config: the ID is escaped");

// 2. Answers of the config poll
Assert(Classify(HttpStatusCode.OK, "pending", false) == PollOutcome.Pending, "200 pending: wait");
Assert(Classify(HttpStatusCode.OK, "approved", true) == PollOutcome.Approved, "200 approved with config: apply");
Assert(Classify(HttpStatusCode.OK, "approved", false) == PollOutcome.Retry, "200 approved without config: poll again");
Assert(Classify(HttpStatusCode.OK, "rejected", false) == PollOutcome.Rejected, "200 rejected: stop");
Assert(Classify(HttpStatusCode.OK, "unknown", false) == PollOutcome.Retry, "200 unknown: poll again");
Assert(Classify(HttpStatusCode.Forbidden, null, false) == PollOutcome.RegisterAgain, "403 (secret wrong or used): register again");
Assert(Classify(HttpStatusCode.Unauthorized, null, false) == PollOutcome.RegisterAgain, "401: register again");
Assert(Classify(HttpStatusCode.NotFound, null, false) == PollOutcome.RegisterAgain, "404 (unknown ID): register again");
Assert(Classify(HttpStatusCode.InternalServerError, null, false) == PollOutcome.Retry, "500: poll again");
Assert(Classify(HttpStatusCode.BadGateway, null, false) == PollOutcome.Retry, "502: poll again");
Assert(Classify(HttpStatusCode.BadRequest, null, false) == PollOutcome.Retry, "400 (server address not set): poll again");

// 3. Which registrations can be polled
Assert(CanPoll("42", "s3cret"), "ID and secret: poll");
Assert(!CanPoll("42", null), "ID of an older agent version without secret: register again");
Assert(!CanPoll("42", ""), "empty secret: register again");
Assert(!CanPoll(null, "s3cret"), "no ID: register");

Console.WriteLine(failures == 0 ? "All registration tests passed" : $"{failures} registration test(s) failed");
return failures == 0 ? 0 : 1;

void Assert(bool condition, string description)
{
    Console.WriteLine($"{(condition ? "PASS" : "FAIL")}  {description}");
    if (!condition) failures++;
}

partial class Program { static int failures; }
