<a href="https://oyeswap.onrender.com/"><img src="https://raw.githubusercontent.com/ooye-sanket/Hire-me-web/refs/heads/main/oyeswap.png" alt="OyeSwap" width="70%" />


<h3>Peer-to-peer file transfers in your browser</h3>

*Cooked up by [Sanket](https://github.com/ooye-sanket) while building fast & secure file sharing solutions.*

Using [WebRTC](http://www.webrtc.org) and [Socket.IO](https://socket.io), OyeSwap eliminates the initial upload step required by other web-based file sharing services. Files are transferred directly between devices in real-time with automatic queue-based resumption if the receiver disconnects. Because data passes through an intelligent relay only when necessary, the transfer is fast, private, and secure.

A hosted instance of OyeSwap is available at [oyeswap.onrender.com](https://oyeswap.onrender.com).

## What's new with OyeSwap

* **Real-time file transfer** using Socket.IO with 512KB chunk streaming for maximum speed.
* **Smart Queue System** - Files automatically resume when receiver reconnects, no restart needed.
* **Dark mode support** with persistent theme settings across sessions.
* **Works everywhere** - Mobile Safari, Chrome, Firefox, Edge on iOS, Android, Desktop.
* **Anonymous transfers** - No login, no accounts, just instant file sharing.
* **Folder support** - Auto-zips folders while preserving directory structure.
* **Live progress tracking** - Real-time speed (MB/s), ETA, and percentage display.
* **Production-grade security** - Rate limiting, file type validation, XSS protection, Helmet headers.
* **Multiple devices** - Send files to several recipients simultaneously.
* **10GB file limit** per transfer with validation and protection.
* **Local network mode** - Ultra-fast transfers on same WiFi (50-200 MB/s).
* **Global access** - Works across different networks when hosted on Render.

## Architecture

![OyeSwap Architecture](https://raw.githubusercontent.com/ooye-sanket/Hire-me-web/refs/heads/main/arch.png)

## Development

```bash
$ git clone https://github.com/ooye-sanket/oyeswap.git
$ cd oyeswap
$ npm install
$ npm start
```

Open `http://localhost:3000` on your computer and `http://192.168.x.x:3000` (shown in terminal) on other devices.




## Stack

* **Node.js** (v18+)
* **Express** - Web framework
* **Socket.IO** - Real-time WebSocket communication
* **Multer** - Multipart form-data handling (MemoryStorage)
* **Helmet** - Security headers middleware
* **express-rate-limit** - DDoS protection
* **JSZip** (Client) - Folder compression
* **Vanilla JavaScript** - No frontend frameworks, pure ES6+
* **CSS3** - Modern styling with dark mode

## Configuration

The server can be customized with the following environment variables:

- `PORT` – Server port number. Defaults to `3000`.
- `NODE_ENV` – Environment mode (`development` or `production`). Affects logging and CORS.
- `ALLOWED_ORIGINS` – CORS allowed origins. Defaults to `*` (all origins).

## Performance Benchmarks

### **Local Network (Same WiFi)**

| WiFi Type | Speed | 5GB Transfer Time |
|-----------|-------|-------------------|
| WiFi 4 (2.4GHz) | 15-30 MB/s | 3-6 minutes |
| WiFi 5 (5GHz) | 50-100 MB/s | 1-2 minutes |
| WiFi 6 (5GHz) | 100-200 MB/s | 30-60 seconds |

### **Internet (Render Hosted)**

| Connection | Speed | 5GB Transfer Time |
|------------|-------|-------------------|
| 4G Mobile | 5-10 MB/s | 8-15 minutes |
| Home Broadband | 10-20 MB/s | 4-8 minutes |
| Fiber | 20-50 MB/s | 2-4 minutes |

*Actual speeds depend on both sender & receiver network quality.*

## FAQ

**How are my files sent?** 

Your files are sent through a relay server that chunks them into 512KB pieces and streams them to the receiver in real-time using Socket.IO. The server never permanently stores your files - they're held temporarily in memory during transfer only. If the receiver disconnects, chunks are queued and automatically delivered when they reconnect.

**Can multiple people download my file at once?** 

Yes! Select multiple devices from the connected device list and send to all of them simultaneously.

**How big can my files be?** 

Up to 10GB per transfer. This limit is enforced for performance and security reasons.

**What happens when I close my browser?** 

If you're the sender and close your browser, the transfer stops immediately. If you're the receiver and disconnect, your files are queued on the server for up to 1 hour and will automatically resume when you reconnect.

**Are my files encrypted?** 

Yes, when hosted on Render (HTTPS), all data is encrypted in transit using TLS 1.3. The server uses Helmet for additional security headers and implements rate limiting to prevent abuse. You can add extra security by using password protection on your transfers (coming soon).

**Do I need to create an account?**

No! OyeSwap is completely anonymous. Just open the app, set a device name, and start transferring.

**What if my IP address keeps changing?**

OyeSwap automatically detects all available IP addresses on your network and displays them when you start the server. Use any of the shown IPs - no more guessing!

**Can I send folders?**

Yes! When you select a folder, OyeSwap automatically zips it while preserving the directory structure, then sends the zip file. The receiver gets a ready-to-extract archive.

## Known Issues

- **First load after 15 min sleep (Render):** Takes 30-50 seconds to wake up when hosted on free tier.
- [ ] **iOS Safari:** Folder upload not supported natively (use zip files as workaround).
- [ ] **Large files on slow networks:** May timeout on very poor connections (increase timeout in future releases).

**Found a bug?** [Open an issue](https://github.com/ooye-sanket/oyeswap/issues)

## Contributing

We welcome contributions! Please follow this workflow:

### **Branch Strategy**

- `main` — Production (protected, only accepts PRs)
- `dev` — Development (all PRs go here first)

### **How to Contribute**

```bash
# Fork the repo, then clone your fork
git clone https://github.com/YOUR_USERNAME/oyeswap.git
cd oyeswap

# Create feature branch from dev
git checkout dev
git checkout -b feature/your-feature-name

# Make changes, commit, push
git add .
git commit -m "Add: Your feature description"
git push origin feature/your-feature-name

# Open PR to 'dev' branch 
```


- [ ] **Progressive Web App (PWA)** - Install as mobile app
- [ ] **End-to-End Encryption** - Zero-knowledge transfers
- [ ] **Password Protection** - Optional password for transfers
- [ ] **QR Code Sharing** - Share link via QR code
- [ ] **Transfer History** - View past transfers
- [ ] **File Preview** - Preview images/videos before download
- [ ] **Custom Expiry** - Set queue expiry time
- [ ] **Multi-language Support** - i18n for global users

## License

OyeSwap is released under the [MIT License](LICENSE).

```
MIT License

Copyright (c) 2024 Sanket

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

<div align="center">

**Made with ❤️ by [Sanket](https://github.com/ooye-sanket)**

[Live Demo](https://oyeswap.onrender.com/) • [Report Bug](https://github.com/ooye-sanket/oyeswap/issues) • [Request Feature](https://github.com/ooye-sanket/oyeswap/issues)

</div>
