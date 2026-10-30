FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && npm ci --omit=dev && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY . .
RUN mkdir -p /data && chown -R node:node /data /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data UPLOAD_DIR=/data/uploads TRUST_PROXY=1
VOLUME /data
USER node
EXPOSE 8080
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","bootstrap.js"]
