# Build each community plugin into an immutable package artifact. This keeps the
# runtime image free of the source checkout while letting DSH install bundles
# through its normal profile mechanism.
FROM node:24-bookworm-slim AS plugin-packages

WORKDIR /build
COPY plugins ./plugins

# Scoped packages pack as `<scope>-<name>-<version>.tgz`, so rename each tarball
# to its directory name and keep the install step below independent of the scope.
RUN mkdir -p /packages && for plugin in dsh-mobile-adapter dsh-remote-control dsh-ai-proxy; do \
        tarball=$(npm pack --pack-destination /packages "./plugins/$plugin" | tail -n 1) \
        && mv "/packages/$tarball" "/packages/$plugin.tgz" \
        || exit 1; \
    done

FROM node:24-bookworm-slim

# 0.1.0-rc.7 still evaluates connection's webRuntime binding. The current
# remote-control and ai-proxy patches omit that inject on purpose (DSH 0.2.1+
# no longer activates the provider), so this image tracks the 0.2.1 line.
ARG DSH_VERSION=0.2.1-rc.5

ENV DSH_HOME=/home/node/.dsh \
    DSH_TELEMETRY_DISABLED=1 \
    DSH_PORT=3080 \
    DSH_LAN_GATEWAY=0

# DSH delegates external-plugin management to pnpm. A tiny Node proxy forwards
# the loopback-only DSH server to the container port without weakening DSH's
# own bind-address policy.
RUN npm install --global --omit=dev pnpm@11.7.0 "@deepseek-ai/dsh@${DSH_VERSION}" \
    && npm cache clean --force \
    && mkdir -p /opt/dsh-home-seed "${DSH_HOME}" \
    && chown -R node:node /opt/dsh-home-seed "${DSH_HOME}"

# Tarballs live outside DSH_HOME so a volume mounted there cannot hide them.
COPY --chown=node:node --from=plugin-packages /packages /opt/dsh-plugins
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/dsh-web
COPY --chown=node:node docker-proxy.mjs docker-ports.mjs docker-sync-plugins.mjs /usr/local/lib/

USER node

# Install into the seed, not the volume path. Startup copies this seed when
# the mounted home has no web profile, then re-adds a tarball only when its
# version differs from the one already installed.
RUN export DSH_HOME=/opt/dsh-home-seed \
    && dsh plugin --profile web add /opt/dsh-plugins/dsh-mobile-adapter.tgz \
    && dsh plugin --profile web add /opt/dsh-plugins/dsh-remote-control.tgz \
    && dsh plugin --profile web add /opt/dsh-plugins/dsh-ai-proxy.tgz \
    && dsh --profile web --dump-config > /tmp/dsh-config.yml \
    && grep -Fq 'dsh-mobile-adapter' /tmp/dsh-config.yml \
    && grep -Fq 'dsh-remote-control' /tmp/dsh-config.yml \
    && grep -Fq 'dsh-ai-proxy' /tmp/dsh-config.yml \
    && rm -f /tmp/dsh-config.yml

EXPOSE 3080
VOLUME ["/home/node/.dsh"]

ENTRYPOINT ["/usr/local/bin/dsh-web"]
