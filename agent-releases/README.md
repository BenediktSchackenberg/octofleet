# Agent releases

Windows agent releases served by the backend at `/api/v1/agent/releases/latest`.
The installer and the agent's auto-updater check this server first and only fall
back to GitHub when no release is published here (see `UpdateFromServer` /
`UpdateFallbackToGitHub` in `service-config.json`).

Each release is a pair of files, as produced by `scripts/Build-Release.ps1`:

```
OctofleetAgent-v0.7.2.zip
OctofleetAgent-v0.7.2.sha256
```

The newest version in this folder is offered to agents. To build one from the
current checkout:

```bash
sudo scripts/publish-local-agent-release.sh 0.7.2
```

To serve an official release instead, download its ZIP and SHA256 file from
GitHub into this folder.
