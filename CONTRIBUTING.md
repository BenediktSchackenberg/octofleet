# Contributing to OpenClaw Inventory Platform

Thank you for your interest in contributing! 🎉

## 🚀 Getting Started

1. **Fork** the repository
2. **Clone** your fork locally
3. **Create** a feature branch
4. **Make** your changes
5. **Test** thoroughly
6. **Submit** a Pull Request

## 📋 Development Setup

### Prerequisites
- Node.js 18+
- Python 3.11+
- .NET 8 SDK
- Docker (for database)
- PostgreSQL 16 + TimescaleDB

### Quick Setup
```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/openclaw-windows-agent.git
cd openclaw-windows-agent

# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install

# Start development
npm run dev  # Frontend
uvicorn main:app --reload  # Backend
```

## 🎯 What to Contribute

### Good First Issues
- Documentation improvements
- Bug fixes
- UI/UX enhancements
- Test coverage

### Feature Ideas
- New inventory collectors
- Additional alert channels (Slack, Teams, Email)
- Dashboard widgets
- Agent improvements

## 📝 Code Style

### Python (Backend)
- Follow PEP 8
- Use type hints
- Document functions with docstrings

### TypeScript (Frontend)
- Use functional components
- Prefer `const` over `let`
- Use TypeScript interfaces

### C# (Agent)
- Follow Microsoft naming conventions
- Use async/await for I/O operations
- Document public APIs

## 🧪 Testing

### Run All Tests
```bash
# API Tests
cd tests/api && pytest

# E2E Tests  
cd tests/e2e && npx playwright test

# Windows Tests
cd tests/windows && ./Run-LocalTests.ps1
```

### Write Tests
- Add tests for new features
- Maintain existing test coverage
- Use meaningful test names

## 📤 Pull Request Process

1. **Update** documentation if needed
2. **Add** tests for new functionality
3. **Ensure** all tests pass
4. **Update** CHANGELOG.md
5. **Request** review from maintainers

### PR Title Format
```
feat: Add new feature
fix: Fix bug in component
docs: Update documentation
test: Add missing tests
refactor: Improve code structure
```

## 🐛 Reporting Bugs

Use GitHub Issues with:
- Clear title
- Steps to reproduce
- Expected vs actual behavior
- Screenshots if applicable
- Environment details

## 💬 Questions?

- Open a [Discussion](https://github.com/BenediktSchackenberg/openclaw-windows-agent/discussions)
- Check existing issues first

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for making OpenClaw better! 🙏
