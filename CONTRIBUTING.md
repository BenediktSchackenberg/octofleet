# Contributing to Octofleet 🐙

First off, thank you for considering contributing to Octofleet! It's people like you that make open source awesome.

## 🚀 Quick Start

1. **Fork the repo** and clone it locally
2. **Set up your environment** (see below)
3. **Pick an issue** - look for `good first issue` labels
4. **Make your changes** in a new branch
5. **Submit a PR** - we'll review it ASAP!

## 🛠️ Development Setup

### Backend (Python/FastAPI)

```bash
cd backend
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

### Windows Agent (C#/.NET 8)

```bash
cd OctofleetAgent.Service
dotnet build
dotnet run
```

## 📁 Project Structure

```
octofleet/
├── backend/           # FastAPI REST API
├── frontend/          # Next.js Web UI
├── OctofleetAgent.Service/    # Windows Service (C#)
├── OctofleetAgent/    # Windows WPF App (C#)
├── linux-agent/       # Bash agent for Linux
├── installer/         # WiX installer & scripts
├── tests/             # E2E and API tests
└── docs/              # Documentation
```

## 🎯 Good First Issues

Look for issues labeled `good first issue` - these are specifically chosen for newcomers:

- They have clear requirements
- They don't require deep knowledge of the codebase
- We'll help you if you get stuck!

## 📝 Code Style

- **Python**: Follow PEP 8, use type hints
- **TypeScript**: Prettier + ESLint (run `npm run lint`)
- **C#**: Standard .NET conventions

## 🌍 Translations and Dates

The UI is available in English, German and Spanish.

- **Text:** add every key to `frontend/src/locales/en.json`, `de.json` and `es.json` and show it with `t("…")` from `useI18n()` – no hardcoded text in components.
- **Dates and numbers:** pass `localeTag()` from `frontend/src/lib/format.ts` as the locale (`date.toLocaleString(localeTag(), …)`), or use its `formatDateTime`, `formatDate`, `formatTime` and `formatNumber`. Never a fixed tag such as `"de-DE"`. They follow the language selected in the UI.
- **Check:** `npm run check:i18n` (also part of the frontend CI job) fails if a file gets more lines with German text or `"de-DE"` than recorded in `frontend/i18n-baseline.json`, which holds the existing backlog. After translating a page, lower the baseline with `node scripts/check-i18n.mjs --update` and commit it.

## 🔀 Pull Request Process

1. Create a branch: `git checkout -b feature/my-feature`
2. Make your changes
3. Test locally
4. Commit with a descriptive message: `feat: Add awesome feature`
5. Push and open a PR
6. Wait for review (usually < 24h)

### Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only
- `refactor:` - Code change that neither fixes a bug nor adds a feature
- `test:` - Adding tests
- `chore:` - Maintenance

## 🤝 Code of Conduct

Be nice. We're all here to learn and build cool stuff together.

## 💬 Need Help?

- **Discord**: Link in README
- **Issues**: Open a question issue
- **Discussions**: GitHub Discussions tab

## 🎉 Recognition

All contributors get:
- Listed in our README
- Our eternal gratitude
- Cool octopus vibes 🐙

---

*Happy coding! Let's build something awesome together.*
