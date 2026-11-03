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

ARG DSH_VERSION=0.1.0-rc.7

ENV DSH_HOME=/home/node/.dsh \
    DSH_TELEMETRY_DISABLED=1 \
    DSH_PORT=3080

# DSH delegates external-plugin management to pnpm. A tiny Node proxy forwards
# the loopback-only DSH server to the container port without weakening DSH's
# own bind-address policy.
RUN npm install --global --omit=dev pnpm@11.7.0 @deepseek-ai/dsh@${DSH_VERSION} \
    && npm cache clean --force \
    && mkdir -p "${DSH_HOME}" \
    && chown -R node:node "${DSH_HOME}"

COPY --chown=node:node --from=plugin-packages /packages /tmp/dsh-plugins

USER node

# `dsh plugin` initializes the web profile and registers every bundle in its
# layer stack. Tarballs mean these are genuine installed packages, not links
# back to the build context.
RUN dsh plugin --profile web add /tmp/dsh-plugins/dsh-mobile-adapter.tgz \
    && dsh plugin --profile web add /tmp/dsh-plugins/dsh-remote-control.tgz \
    && dsh plugin --profile web add /tmp/dsh-plugins/dsh-ai-proxy.tgz \
    && dsh --profile web --dump-config > /tmp/dsh-config.yml \
    && grep -Fq 'dsh-mobile-adapter' /tmp/dsh-config.yml \
    && grep -Fq 'dsh-remote-control' /tmp/dsh-config.yml \
    && grep -Fq 'dsh-ai-proxy' /tmp/dsh-config.yml \
    && rm -rf /tmp/dsh-plugins /tmp/dsh-config.yml

COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/dsh-web
COPY --chown=node:node docker-proxy.mjs /usr/local/lib/dsh-proxy.mjs

EXPOSE 3080
VOLUME ["/home/node/.dsh"]

ENTRYPOINT ["/usr/local/bin/dsh-web"]
