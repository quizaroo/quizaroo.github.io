FROM node:24-slim
WORKDIR /app
COPY server.js admin.js admin-page.html admin-page.js admin-page.css package.json ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8797 DATA_DIR=/data
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8797
HEALTHCHECK --interval=30s CMD node -e "fetch('http://127.0.0.1:8797/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
