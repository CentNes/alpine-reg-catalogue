# Regulatory Knowledge Service — container image (Stage 2 deployment).
#
# Host-agnostic: runs on any container host (Render / Railway / Fly / a VM).
# The SQLite DB is a CACHE, re-seeded from data/*.json on every boot — git is
# the source of record — so the container is effectively stateless and needs no
# persistent volume. Approved edits are published back to git via a PR
# (scripts/publish-pr.mjs), which runs in CI with the repo's own token; the
# running service does not need write access to GitHub.
#
#   docker build -t reg-catalogue .
#   docker run -p 7817:7817 reg-catalogue      # admin UI at http://localhost:7817/admin

# node:sqlite is stable (no flag) from Node 24; earlier majors lack it or gate it.
FROM node:24-alpine

WORKDIR /app

# No third-party deps (node:sqlite + node:http). Copy only what the service reads.
COPY service/ ./service/
COPY scripts/ ./scripts/
COPY data/ ./data/
COPY package.json ./

ENV PORT=7817
# DB is a cache re-seeded from data/ on boot; keep it in a writable path (the
# app dir is owned by root / read-only for the non-root runtime user).
ENV DB_PATH=/tmp/catalogue.db
EXPOSE 7817

# Non-root for safety.
USER node

HEALTHCHECK --interval=30s --timeout=4s --retries=3 \
  CMD node -e "fetch('http://localhost:'+ (process.env.PORT||7817) +'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "service/server.mjs"]
