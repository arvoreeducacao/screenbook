FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium tmux ca-certificates fonts-liberation fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*
RUN npm i -g @anthropic-ai/claude-code@2.1.304 --no-audit --no-fund && npm cache clean --force
ENV SCREENBOOK_CHROME=/usr/bin/chromium
ENV SCREENBOOK_AI_HOME=/tmp/screenbook-ai
ENV DISABLE_AUTOUPDATER=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY bin ./bin
COPY src ./src
COPY viewer ./viewer
COPY skills ./skills
USER node
EXPOSE 4600
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:4600/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "bin/screenbook.js", "serve", "--host", "0.0.0.0", "--port", "4600"]
