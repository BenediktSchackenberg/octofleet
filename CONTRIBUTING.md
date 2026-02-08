# Contributing to OpenClaw Inventory Platform

Thanks for your interest in contributing! 🎉

## 🚀 Quick Start

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/YOUR-USERNAME/openclaw-windows-agent.git`
3. **Create a branch**: `git checkout -b feature/my-feature`
4. **Make your changes**
5. **Test** your changes
6. **Commit**: `git commit -m "feat: Add my feature"`
7. **Push**: `git push origin feature/my-feature`
8. **Open a Pull Request**

## 📁 Project Structure

```
openclaw-windows-agent/
├── agent/          # Windows Agent (.NET 8, C#)
├── backend/        # API Server (Python, FastAPI)
├── frontend/       # Web Dashboard (TypeScript, Next.js)
├── installer/      # PowerShell install scripts
└── docs/           # Documentation
```

## 🛠️ Development Setup

### Backend (FastAPI)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8080
```

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

### Agent (.NET)

```bash
cd agent
dotnet restore
dotnet build
```

## 📝 Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

| Type | Description |
|------|-------------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `style:` | Formatting, no code change |
| `refactor:` | Code restructuring |
| `test:` | Adding tests |
| `chore:` | Maintenance tasks |

Examples:
```
feat: Add package deployment to job system
fix: Resolve MSI installation timeout issue
docs: Update README with architecture diagram
```

## 🐛 Bug Reports

Please include:
- **OS and version** (Windows 10/11, Server 2019/2022)
- **Agent version** (check `C:\Program Files\OpenClaw\Agent\version.txt`)
- **Steps to reproduce**
- **Expected vs actual behavior**
- **Logs** (if applicable)

## 💡 Feature Requests

Open an issue with:
- **Use case** — What problem are you trying to solve?
- **Proposed solution** — How should it work?
- **Alternatives** — Other approaches you considered?

## 🧪 Testing

### Backend
```bash
cd backend
pytest
```

### Frontend
```bash
cd frontend
npm run lint
npm run build
```

### Agent
```bash
cd agent
dotnet test
```

## 📋 Code Style

### Python (Backend)
- Follow PEP 8
- Use type hints
- Docstrings for public functions

### TypeScript (Frontend)
- ESLint + Prettier (auto-configured)
- Functional components with hooks
- Use TypeScript types, avoid `any`

### C# (Agent)
- Follow .NET naming conventions
- XML documentation for public APIs
- Async/await for I/O operations

## 🔀 Pull Request Process

1. Update documentation if needed
2. Add tests for new features
3. Ensure all tests pass
4. Request review from maintainers
5. Squash commits before merge (if requested)

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Questions? Join our [Discord](https://discord.com/invite/clawd) or open an issue!
