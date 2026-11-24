using System.Net;

namespace OctofleetAgent.Service;

/// <summary>
/// The server side of the self-registration: POST /api/v1/nodes/register answers with a pending ID and
/// a one-time secret, which the agent sends with every poll of GET /api/v1/pending-nodes/{id}/config.
/// After approval the configuration is handed out once; the secret is invalid afterwards.
/// </summary>
public static class PendingRegistrationProtocol
{
    public const string SecretHeader = "X-Registration-Secret";

    public enum PollOutcome
    {
        /// <summary>Still waiting for an admin</summary>
        Pending,
        Approved,
        Rejected,
        /// <summary>Unknown ID, or the secret is wrong or used: this registration is lost, register again</summary>
        RegisterAgain,
        /// <summary>Server error or unexpected answer: poll again later</summary>
        Retry,
    }

    public static HttpRequestMessage ConfigRequest(string backendUrl, string pendingId, string secret)
    {
        var request = new HttpRequestMessage(HttpMethod.Get,
            $"{backendUrl.TrimEnd('/')}/api/v1/pending-nodes/{Uri.EscapeDataString(pendingId)}/config");
        request.Headers.Add(SecretHeader, secret);
        return request;
    }

    /// <param name="status">HTTP status of the config poll</param>
    /// <param name="resultStatus">"status" of the answer (successful polls only)</param>
    /// <param name="hasConfig">The answer carries a configuration</param>
    public static PollOutcome Classify(HttpStatusCode status, string? resultStatus, bool hasConfig)
    {
        if (status is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.NotFound)
            return PollOutcome.RegisterAgain;
        if ((int)status < 200 || (int)status > 299)
            return PollOutcome.Retry;
        return resultStatus switch
        {
            "approved" when hasConfig => PollOutcome.Approved,
            "rejected" => PollOutcome.Rejected,
            "pending" => PollOutcome.Pending,
            _ => PollOutcome.Retry,
        };
    }

    /// <summary>A registration the agent can poll for: an ID and a secret. Without the secret (the
    /// machine is already registered and waiting, by another installation) it cannot.</summary>
    public static bool CanPoll(string? pendingId, string? secret) =>
        !string.IsNullOrEmpty(pendingId) && !string.IsNullOrEmpty(secret);
}
