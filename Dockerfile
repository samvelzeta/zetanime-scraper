FROM mcr.microsoft.com/playwright:v1.42.1-jammy
RUN apt-get update && apt-get install -y --no-install-recommends libasound2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN npm install
CMD ["node", "bot.js"]
