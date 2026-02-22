---
title: "Building Octofleet: A Week of Zero-Touch Server Deployments (Looking for Contributors! 🐙)"
published: true
description: "How I built PXE-based OS deployment into my endpoint management platform - and why I'm looking for people to join the fun!"
tags: devops, opensource, homelab, windows
cover_image: https://benediktschackenberg.github.io/assets/images/octofleet-logo-v2.png
---

# Building Octofleet: A Week of Zero-Touch Server Deployments 🐙

Hey dev.to! 

This is just a hobby project I've been hacking on because it's **mega fun** - and I wanted to share what happened this week. Also: **I'm looking for contributors!** More on that at the end.

## What is Octofleet?

Octofleet is an open-source endpoint management platform I've been building. Think of it as an octopus 🐙 with 8 arms handling all your server tasks:

- 📊 **Inventory** - Track all your machines
- 🔧 **Patching** - Keep systems updated  
- 💼 **Job System** - Run scripts remotely
- 📦 **Packages** - Deploy software
- 🛡️ **Vulnerability Tracking** - Stay secure
- 🖥️ **Screen Sharing** - See what's happening
- ⚙️ **Service Orchestration** - Manage services across fleet
- 🚀 **PXE Deployment** - Zero-touch OS installs ← *NEW THIS WEEK!*

## This Week's Adventure: PXE Boot

I wanted to solve a problem: How do I deploy Windows Server to 10 VMs without touching each one?

The answer: **PXE Boot + iPXE + WinPE + HTTP**

### The Goal

1. Enter MAC address in Web UI
2. Select OS (Windows Server 2025, Ubuntu, etc.)
3. Click "Create Job"
4. Power on server
5. ☕ Grab coffee
6. Come back to a fully installed, domain-joined server

### What I Built

**Backend (FastAPI + PostgreSQL):**
- Provisioning API with CRUD for tasks, images, templates
- Dynamic iPXE script generation per MAC address
- Status callbacks so machines report their progress

**Frontend (Next.js + Tailwind):**
- Provisioning dashboard with live task queue
- "New Job" dialog with MAC/OS selection
- Auto-refresh every 10 seconds

**PXE Infrastructure:**
- dnsmasq for DHCP + TFTP
- nginx serving boot files over HTTP
- Custom WinPE image with curl.exe injected

### The Fun Bugs 🐛

Oh boy, where do I start...

**Bug 1: "Bad CPIO magic" on Hyper-V**
- Turns out wimboot has issues with Hyper-V Gen1 (BIOS mode)
- Fix: Use Gen2 (UEFI) - works perfectly!

**Bug 2: SMB is too slow in WinPE**
- WinPE's SMB client waits forever for DNS
- Fix: HTTP everything! Injected curl.exe into WinPE

**Bug 3: DISM Error 87**
- Scripts weren't running...
- Cause: Unix line endings (LF) instead of Windows (CRLF)
- Fix: `unix2dos startnet.cmd` 🤦

**Bug 4: VirtIO disk not found**
- KVM VMs couldn't see their disks
- Wrong driver: `viostor.inf` vs `vioscsi.inf`
- SCSI needs vioscsi!

### Current Status

✅ **Working:**
- Hyper-V Gen2 deployment
- Windows Server 2025 (all editions)
- Full unattend.xml automation
- German locale & timezone
- RDP enabled out of the box
- Web UI connected to real API

🚧 **In Progress:**
- Ubuntu/Linux support (Autoinstall)
- Windows 11 client deployment
- KVM/libvirt testing
- Live status callbacks in UI

## The Tech Stack

```
┌─────────────────────────────────────────────┐
│              Octofleet UI                   │
│         (Next.js + Tailwind CSS)            │
└─────────────────┬───────────────────────────┘
                  │ HTTP/REST
┌─────────────────▼───────────────────────────┐
│           Octofleet Backend                 │
│      (FastAPI + PostgreSQL + asyncpg)       │
└─────────────────┬───────────────────────────┘
                  │ 
┌─────────────────▼───────────────────────────┐
│             PXE Server                      │
│   (dnsmasq + nginx + iPXE + WinPE)          │
└─────────────────────────────────────────────┘
```

## Why I Love This Project

It's the perfect intersection of:
- **Networking** (PXE, DHCP, TFTP, HTTP)
- **Windows internals** (WinPE, DISM, BCD)
- **Linux** (dnsmasq, Samba, nginx)
- **Modern web** (React, FastAPI, WebSockets)
- **DevOps** (automation, CI/CD, infrastructure as code)

Every day I learn something new. This week alone I learned:
- How iPXE works internally
- WinPE customization
- The difference between BIOS and UEFI boot
- Why SMB in WinPE is painful
- How to inject files into a boot image

## Looking for Contributors! 🙋‍♂️

This is where you come in! I'm looking for people who want to:

- **Use it** - Test it in your homelab, report bugs
- **Hack on it** - Pick an issue, send a PR
- **Document** - Help make the docs better
- **Design** - The UI could always be prettier
- **Ideas** - What features would YOU want?

**No experience required!** If you're learning and want a real project to contribute to, this is it. I'll help you get started.

### Good First Issues

- 🐧 Add Ubuntu 24.04 support
- 📝 Improve API documentation
- 🧪 Write more tests
- 🎨 Dark mode improvements
- 📊 Dashboard widgets

### How to Get Started

1. **Star the repo**: [github.com/BenediktSchackenberg/octofleet](https://github.com/BenediktSchackenberg/octofleet)
2. **Check the issues**: Look for `good first issue` labels
3. **Join the Discord**: Link in the repo README
4. **Say hi!** Drop a comment here or open a discussion

## What's Next?

Next week I'm planning to:
- Get Ubuntu autoinstall working
- Add Windows 11 support
- Build a "Systems Registry" to track provisioned machines
- Maybe record a demo video?

## Conclusion

Building Octofleet has been incredibly fun. There's something magical about:

1. Clicking a button
2. Watching a VM boot from the network
3. Seeing Windows install itself
4. Getting a notification "Server ready!"

All without touching a single USB stick or clicking through an installer.

If this sounds interesting to you - come join the fun! 🐙

---

**Links:**
- 🐙 GitHub: [BenediktSchackenberg/octofleet](https://github.com/BenediktSchackenberg/octofleet)
- 📝 Blog: [schackenberg.com](https://benediktschackenberg.github.io)
- 💬 Discord: Link in repo

*Happy deploying!*
