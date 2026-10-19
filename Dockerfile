# Gezinsagenda als container, voor een online host zoals Fly.io.
FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
COPY scripts ./scripts
# De host regelt https zelf; de gegevens staan op een blijvende schijf in /data.
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data NO_TLS=1
EXPOSE 8080
USER node
CMD ["node", "server.js"]
