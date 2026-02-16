# Contributing to Octofleet

First off, thank you for considering contributing to Octofleet! 🐙

## 🚀 Quick Start for Contributors

### Prerequisites
- Docker & Docker Compose
- Node.js 20+
- Python 3.12+
- .NET 8 SDK (for Windows Agent development)

### Development Setup

```bash
# Clone the repo
git clone https://github.com/BenediktSchackenberg/octofleet.git
cd octofleet

# Start the database
docker compose up -d db

# Backend
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8080

# Frontend (new terminal)
cd frontend
npm install
npm run dev

# Open http://localhost:3000
```

## 🐛 Reporting Bugs

Before creating a bug report, please check existing issues to avoid duplicates.

**Good bug reports include:**
- Clear title and description
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable
- Environment details (OS, browser, agent version)

## 💡 Suggesting Features

We welcome feature requests! Please:
- Check if it's already on the [Roadmap](../../wiki/Roadmap)
- Describe the problem you're trying to solve
- Propose your solution

## 🔧 Pull Requests

### Workflow

1. **Fork** the repository
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/my-feature
   # or
   git checkout -b fix/bug-description
   ```
3. **Make your changes**
4. **Test your changes**:
   ```bash
   # API Tests
   cd tests/api && pytest
   
   # E2E Tests
   cd tests/e2e && npx playwright test
   
   # Windows Agent Tests (on Windows)
   cd tests/windows && ./Run-LocalTests.ps1
   ```
5. **Commit** with a clear message:
   ```bash
   git commit -m "feat: add new dashboard widget"
   # or
   git commit -m "fix: resolve memory leak in agent"
   ```
6. **Push** to your fork
7. **Open a Pull Request**

### Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation only
- `style:` Formatting, no code change
- `refactor:` Code change that neither fixes a bug nor adds a feature
- `test:` Adding tests
- `chore:` Maintenance tasks

### Code Style

- **Python:** Follow PEP 8, use type hints
- **TypeScript:** Use ESLint + Prettier config from repo
- **C#:** Follow .NET conventions

## 🏷️ Good First Issues

New to Octofleet? Look for issues labeled [`good first issue`](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).

These are smaller, well-defined tasks perfect for getting familiar with the codebase.

## 📁 Project Structure

```
octofleet/
├── backend/           # FastAPI backend (Python)
│   ├── main.py        # API endpoints
│   ├── remediation.py # Auto-remediation logic
│   └── schema-full.sql
├── frontend/          # Next.js frontend (TypeScript)
│   └── src/app/       # Pages and components
├── src/               # Windows Agent (.NET 8)
│   └── OctofleetAgent.Service/
├── linux-agent/       # Linux Agent (Bash)
├── tests/
│   ├── api/           # API tests (pytest)
│   ├── e2e/           # E2E tests (Playwright)
│   └── windows/       # Agent tests (Pester)
└── docs/              # Documentation
```

## 🧪 Testing

All PRs should include tests where applicable:

- **Backend changes:** Add pytest tests in `tests/api/`
- **Frontend changes:** Add Playwright tests in `tests/e2e/`
- **Agent changes:** Add Pester tests in `tests/windows/`

## 📖 Documentation

- Update the Wiki for user-facing changes
- Add JSDoc/docstrings for new functions
- Update README if adding major features

## 🤔 Questions?

- Open a [Discussion](../../discussions)
- Check the [Wiki](../../wiki)
- Look at existing [Issues](../../issues)

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for making Octofleet better!** 🐙❤️
