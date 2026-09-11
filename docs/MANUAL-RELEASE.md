# Build a Windows agent release locally

Use this path when GitHub Actions is unavailable. It builds the same service and
screen helper as CI without installing or starting either program.

1. Choose an unused version and commit the source changes. When Actions must
   not run, include `[skip ci]` in that commit message; run the checks locally.
2. Run the regression checks:

   ```powershell
   ./tests/windows/Release-Package.Tests.ps1
   dotnet run --project tests/OctofleetAgent.Inventory.Tests -c Release
   ```

3. Build from the clean commit, supplying the thumbprint of your existing
   code-signing certificate:

   ```powershell
   ./scripts/Build-Release.ps1 -Version 0.7.1 -OutputPath ./release/v0.7.1 -SigningThumbprint '<certificate thumbprint>'
   ```

   The script creates a fresh staging directory, validates its contents, signs
   both executables, verifies their signatures and timestamps, and only then
   creates `OctofleetAgent-v0.7.1.zip` and `OctofleetAgent-v0.7.1.sha256`.
   Signing failure aborts packaging. Omitting `SigningThumbprint` produces an
   unsigned test package. No files are uploaded unless `CreateRelease` is used.

4. Tag the tested commit as `v0.7.1` and push the source and tag.
5. Create the GitHub release manually for that tag. Attach the ZIP, checksum and
   repository-root `Install-OctofleetAgent.ps1`. Include the source commit and
   test results in the release notes. Verify the attachments before publishing.

The tag-push workflow remains available for future CI builds. The redundant
release-created workflow has been removed, so manual publication does not
start a second build that could overwrite the locally signed assets.
