# ─── Base image ───────────────────────────────────────────────────────────────
FROM node:20-slim

# ─── System dependencies for Playwright / Chromium ────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Core GLib / GTK stack
    libglib2.0-0 \
    libgtk-3-0 \
    # X11 & display
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxinerama1 \
    libxkbcommon0 \
    libxkbcommon-x11-0 \
    libxkbfile1 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    # Fonts & rendering
    libcairo2 \
    libcairo-gobject2 \
    libfontconfig1 \
    libfreetype6 \
    libgdk-pixbuf-2.0-0 \
    libharfbuzz0b \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    fonts-liberation \
    # Security / crypto
    libnss3 \
    libnspr4 \
    # Accessibility
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libatspi2.0-0 \
    # GPU / DRM
    libdrm2 \
    libgbm1 \
    libxshmfence1 \
    libvulkan1 \
    # Misc runtime
    libappindicator3-1 \
    libu2f-udev \
    xdg-utils \
    wget \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ─── Working directory ─────────────────────────────────────────────────────────
WORKDIR /app

# ─── Install Node dependencies (and Chromium via postinstall) ─────────────────
COPY package.json package-lock.json* ./
RUN npm install

# ─── Copy application source ───────────────────────────────────────────────────
COPY . .

# ─── Start ────────────────────────────────────────────────────────────────────
CMD ["node", "bot.js"]
