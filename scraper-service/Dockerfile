FROM python:3.12-slim

# Install ALL system deps required by Playwright Chromium
# Using --with-deps would also work but this is more explicit for Docker slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg2 \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libatspi2.0-0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    libx11-6 libx11-xcb1 libxcb1 libxext6 \
    libxshmfence1 libglib2.0-0 libexpat1 \
    fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright Chromium with system deps
RUN playwright install chromium --with-deps || playwright install chromium

# Copy all scraper code
COPY . .

# Render provides PORT env var (usually 10000)
# Use shell form so $PORT is resolved at runtime
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}
