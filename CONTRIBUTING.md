# Contributing to OpenClaw Inventory

Thank you for your interest in contributing! 🎉

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR-USERNAME/openclaw-windows-agent.git`
3. Create a branch: `git checkout -b feature/your-feature`

## Development Setup

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install pytest pytest-asyncio  # For tests

# Run tests
pytest

# Run with hot reload
uvicorn main:app --reload --port 8080
```

### Frontend

```bash
cd frontend
npm install

# Run dev server
npm run dev

# Run tests
npm test

# Run E2E tests
npx playwright test
```

### Windows Agent

```bash
cd src
dotnet build
dotnet test
```

## Code Style

- **Python**: Black formatter, isort for imports
- **TypeScript**: Prettier + ESLint
- **C#**: Standard .NET conventions

## Pull Request Process

1. Ensure tests pass
2. Update documentation if needed
3. Add entry to CHANGELOG.md
4. Request review from maintainers

## Commit Messages

Follow conventional commits:

```
feat: add new feature
fix: fix bug
docs: update documentation
test: add tests
refactor: code refactoring
```

## Reporting Issues

Please include:
- OS and version
- Steps to reproduce
- Expected vs actual behavior
- Logs/screenshots if applicable

## Questions?

- Open an issue
- Join [Discord](https://discord.com/invite/clawd)

## License

By contributing, you agree your contributions are licensed under MIT.
